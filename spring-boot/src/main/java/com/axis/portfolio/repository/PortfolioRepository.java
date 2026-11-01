package com.axis.portfolio.repository;
import com.axis.portfolio.config.PortfolioProperties;
import com.axis.portfolio.dto.Responses.*;
import com.axis.portfolio.exception.ApiProblem;
import com.axis.portfolio.service.CursorCodec.Position;
import com.axis.portfolio.service.ReportQuery;
import java.math.*;
import java.sql.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.jdbc.core.namedparam.*;
import org.springframework.stereotype.Repository;
@Repository
public class PortfolioRepository {
    public record Result(Meta meta,List<Group> groups,List<Loan> loans) {}
    private final NamedParameterJdbcTemplate jdbc;
    private final String hint;
    public PortfolioRepository(NamedParameterJdbcTemplate jdbc,PortfolioProperties settings) {
        this.jdbc=jdbc;
        jdbc.getJdbcTemplate().setQueryTimeout(settings.querySeconds());
        Boolean rcsi;
        try { rcsi=jdbc.getJdbcTemplate().queryForObject("SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name=DB_NAME()",Boolean.class); }
        catch(org.springframework.dao.DataAccessException ex) { throw new IllegalStateException("Reporting database is not ready"); }
        hint=Boolean.TRUE.equals(rcsi)?"":" WITH (HOLDLOCK)";
    }
    public String consistencyHint() { return hint; }
    public Result query(String tenant,ReportQuery q,Position position) {
        MapSqlParameterSource params=new MapSqlParameterSource().addValue("tenant",tenant,Types.VARCHAR).addValue("status",q.status(),Types.VARCHAR);
        StringBuilder where=new StringBuilder("p.Status=:status");
        filter(where,params,"p.Division","division",q.division(),Types.NVARCHAR);
        filter(where,params,"p.BorrowerType","borrower",q.borrowerType(),Types.VARCHAR);
        filter(where,params,"p.LoanRiskRating","risk",q.riskRating(),Types.VARCHAR);
        if(q.from()!=null) { where.append(" AND p.OriginationDate>=:fromDate");params.addValue("fromDate",java.sql.Date.valueOf(q.from()),Types.DATE); }
        if(q.to()!=null) { where.append(" AND p.OriginationDate<=:toDate");params.addValue("toDate",java.sql.Date.valueOf(q.to()),Types.DATE); }
        if(q.kind()!=ReportQuery.Kind.GROUPS) path(where,params,q.group().column,"parent",q.key(),q.nullKey(),q.group().length);
        if(q.kind()==ReportQuery.Kind.LOANS && q.subgroup()!=null) path(where,params,q.subgroup().column,"child",q.subkey(),q.nullSubkey(),q.subgroup().length);
        String prefix="""
            WITH Source AS (SELECT p.* FROM analytics.PublishedLoanPortfolio p%s WHERE p.TenantId=CAST(:tenant AS uniqueidentifier)),
            Meta AS (SELECT COALESCE(MAX(SourceVersion),0) AS SnapshotVersion,MAX(LastSyncedUtc) AS AsOfUtc,
                (SELECT CONVERT(varchar(36),PublishedRunId) FROM analytics.RiskPublication%s WHERE TenantId=CAST(:tenant AS uniqueidentifier)) AS PublishedRun
                FROM Source),
            """.formatted(hint,hint);
        String sql;
        if(q.kind()==ReportQuery.Kind.LOANS) {
            params.addValue("take",q.limit()+1,Types.INTEGER);
            if(position!=null) {
                where.append(" AND (p.LoanNumber>:lastNumber OR (p.LoanNumber=:lastNumber AND p.LoanId>CAST(:lastId AS uniqueidentifier)))");
                params.addValue("lastNumber",position.number(),Types.NVARCHAR); params.addValue("lastId",position.id(),Types.VARCHAR);
            }
            sql=prefix+"ReportRows AS (SELECT TOP(:take) p.* FROM Source p WHERE "+where+" ORDER BY p.LoanNumber,p.LoanId) "
                +"SELECT m.*,r.* FROM Meta m LEFT JOIN ReportRows r ON 1=1 ORDER BY r.LoanNumber,r.LoanId";
        } else {
            var dimension=q.kind()==ReportQuery.Kind.CHILDREN?q.subgroup():q.group();
            // This identifier is exclusively selected from the server enum, never from raw user input.
            sql=prefix+"ReportRows AS (SELECT TOP(101) p."+dimension.column+" AS GroupKey,COUNT_BIG(*) AS LoanCount,"
                +"SUM(p.CurrentBalance) AS TotalBalance,AVG(CAST(p.InterestRate AS decimal(18,8))) AS AverageRate "
                +"FROM Source p WHERE "+where+" GROUP BY p."+dimension.column+" ORDER BY p."+dimension.column+") "
                +"SELECT m.*,r.* FROM Meta m LEFT JOIN ReportRows r ON 1=1 ORDER BY r.GroupKey";
        }
        return jdbc.query(sql,params,rs->{
            Meta meta=null; List<Group> groups=new ArrayList<>(); List<Loan> loans=new ArrayList<>();
            while(rs.next()) {
                if(meta==null) meta=new Meta(rs.getLong("SnapshotVersion"),rs.getString("PublishedRun"),instant(rs,"AsOfUtc"));
                if(q.kind()==ReportQuery.Kind.LOANS) {
                    if(rs.getString("LoanId")!=null) loans.add(loan(rs));
                } else if(rs.getObject("LoanCount")!=null) {
                    String key=rs.getString("GroupKey");
                    var dim=q.kind()==ReportQuery.Kind.CHILDREN?q.subgroup():q.group();
                    groups.add(new Group(key,key==null?(dim==ReportQuery.Dimension.RISK?"Unrated":"Unassigned"):key,
                        rs.getLong("LoanCount"),decimal(rs.getBigDecimal("TotalBalance"),2),decimal(rs.getBigDecimal("AverageRate"),8),
                        q.kind()==ReportQuery.Kind.GROUPS && q.subgroup()!=null));
                }
            }
            if(groups.size()>100) throw ApiProblem.bad("GROUP_LIMIT_EXCEEDED");
            if(meta==null) throw new IllegalStateException("Missing report metadata");
            return new Result(meta,List.copyOf(groups),List.copyOf(loans));
        });
    }
    private static void filter(StringBuilder where,MapSqlParameterSource p,String column,String name,String value,int type) {
        if(value!=null) { where.append(" AND ").append(column).append("=:").append(name); p.addValue(name,value,type); }
    }
    private static void path(StringBuilder where,MapSqlParameterSource p,String column,String name,String key,boolean isNull,int maximum) {
        if(isNull) where.append(" AND p.").append(column).append(" IS NULL");
        else { where.append(" AND p.").append(column).append("=:").append(name);
            p.addValue(name,key,column.equals("Division") || column.equals("LoanOfficer")?Types.NVARCHAR:Types.VARCHAR); }
    }
    public static String decimal(BigDecimal value,int scale) { return value==null?null:value.setScale(scale,RoundingMode.UNNECESSARY).toPlainString(); }
    private static String instant(ResultSet rs,String column) throws SQLException {
        LocalDateTime value=rs.getObject(column,LocalDateTime.class);
        return value==null?null:DateTimeFormatter.ISO_INSTANT.format(value.toInstant(ZoneOffset.UTC));
    }
    private static String date(ResultSet rs,String column) throws SQLException {
        LocalDate value=rs.getObject(column,LocalDate.class); return value==null?null:value.toString();
    }
    private static Loan loan(ResultSet r) throws SQLException {
        return new Loan(r.getString("LoanId").toLowerCase(Locale.ROOT),r.getString("LoanNumber"),r.getString("BorrowerName"),
            r.getString("BorrowerType"),r.getString("Industry"),r.getString("Division"),r.getString("LoanOfficer"),
            decimal(r.getBigDecimal("PrincipalAmount"),2),decimal(r.getBigDecimal("CurrentBalance"),2),decimal(r.getBigDecimal("InterestRate"),8),
            r.getString("Status"),date(r,"OriginationDate"),date(r,"MaturityDate"),r.getInt("DaysPastDue"),date(r,"LastPaymentDate"),
            r.getString("BorrowerRiskRating"),r.getString("LoanRiskRating"));
    }
}

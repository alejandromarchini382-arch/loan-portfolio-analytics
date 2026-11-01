package com.axis.portfolio.service;
import com.axis.portfolio.config.PortfolioProperties;
import com.axis.portfolio.exception.ApiProblem;
import com.axis.portfolio.repository.PortfolioRepository;
import com.fasterxml.jackson.databind.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.namedparam.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.*;
@Service
public class RiskGateway {
    private final NamedParameterJdbcTemplate jdbc; private final RestClient flask; private final ObjectMapper json; private final String hint;
    public RiskGateway(NamedParameterJdbcTemplate jdbc,PortfolioProperties p,ObjectMapper json,PortfolioRepository repository) {
        this.jdbc=jdbc; this.json=json; this.hint=repository.consistencyHint();
        var factory=new SimpleClientHttpRequestFactory(); factory.setConnectTimeout(5000); factory.setReadTimeout(5000);
        this.flask=RestClient.builder().baseUrl(p.flaskBaseUrl()).requestFactory(factory).build();
    }
    public Map<String,Object> submit(String tenant,String bearer,String key,String requestId) {
        if(key==null || key.isBlank() || key.length()>120 || !key.equals(key.strip()) || key.chars().anyMatch(c->c<32 || c>126))
            throw ApiProblem.bad("INVALID_IDEMPOTENCY_KEY");
        JsonNode response;
        try {
            response=flask.post().uri("/risk/runs").header(HttpHeaders.AUTHORIZATION,bearer).header("Idempotency-Key",key)
                .contentType(MediaType.APPLICATION_JSON).body(Map.of()).retrieve().body(JsonNode.class);
        } catch(RestClientResponseException ex) {
            int status=ex.getStatusCode().value();
            if(!Set.of(400,401,403,409,429,503).contains(status)) status=503;
            String code="FLASK_UNAVAILABLE";
            try {
                String offered=json.readTree(ex.getResponseBodyAsByteArray()).path("error").path("code").asText();
                if(Set.of("ACTIVE_RUN_EXISTS","RUN_SUBMISSION_THROTTLED","INVALID_REQUEST","INVALID_IDEMPOTENCY_KEY",
                    "UNAUTHENTICATED","FORBIDDEN","DATABASE_UNAVAILABLE","JOB_LOCK_BUSY").contains(offered)) code=offered;
            } catch(Exception ignored) { /* Only allowlisted operational codes cross the boundary. */ }
            throw new ApiProblem(status,code);
        } catch(RestClientException ex) { throw new ApiProblem(503,"FLASK_UNAVAILABLE"); }
        String run;
        try { run=PortfolioProperties.uuid(response.path("runId").asText()); }
        catch(RuntimeException ex) { throw new ApiProblem(503,"FLASK_UNAVAILABLE"); }
        var params=new MapSqlParameterSource().addValue("tenant",tenant).addValue("run",run);
        return jdbc.query("SELECT CONVERT(varchar(36),JobId) JobId,Status FROM analytics.RiskJob WHERE TenantId=CAST(:tenant AS uniqueidentifier) AND RunId=CAST(:run AS uniqueidentifier)",params,rs->{
            if(!rs.next()) throw new ApiProblem(503,"RUN_MAPPING_UNAVAILABLE");
            return Map.of("jobId",rs.getString("JobId"),"status",rs.getString("Status"),"requestId",requestId);
        });
    }
    public Map<String,Object> status(String tenant,String job,String requestId) {
        try { job=PortfolioProperties.uuid(job); } catch(RuntimeException ex) { throw ApiProblem.bad("INVALID_JOB_ID"); }
        var params=new MapSqlParameterSource().addValue("tenant",tenant).addValue("job",job);
        return jdbc.query(""" 
            SELECT CONVERT(varchar(36),JobId) JobId,Status,ProcessedLoans,TotalLoans FROM analytics.RiskJob
            WHERE TenantId=CAST(:tenant AS uniqueidentifier) AND JobId=CAST(:job AS uniqueidentifier)
            """,params,rs->{
            if(!rs.next()) throw new ApiProblem(404,"JOB_NOT_FOUND");
            return Map.of("jobId",rs.getString("JobId"),"status",rs.getString("Status"),"processedLoans",rs.getInt("ProcessedLoans"),
                "totalLoans",rs.getInt("TotalLoans"),"requestId",requestId);
        });
    }
    public Map<String,Object> latest(String tenant) {
        String sql="""
            SELECT CONVERT(varchar(36),p.PublishedRunId) PublishedRun,p.PublishedAtUtc,j.Status,j.CreatedAtUtc
            FROM (VALUES(1)) root(n)
            OUTER APPLY (SELECT PublishedRunId,PublishedAtUtc FROM analytics.RiskPublication%s WHERE TenantId=CAST(:tenant AS uniqueidentifier)) p
            OUTER APPLY (SELECT TOP(1) Status,CreatedAtUtc FROM analytics.RiskJob%s WHERE TenantId=CAST(:tenant AS uniqueidentifier)
                ORDER BY CreatedAtUtc DESC,JobId DESC) j
            """.formatted(hint,hint);
        return jdbc.query(sql,Map.of("tenant",tenant),rs->{
            rs.next(); Map<String,Object> result=new LinkedHashMap<>();
            result.put("runId",rs.getString("PublishedRun"));result.put("policyVersion","risk-demo-v1");
            result.put("publishedAtUtc",utc(rs,"PublishedAtUtc"));result.put("jobStatus",rs.getString("Status"));
            result.put("lastRequestedAtUtc",utc(rs,"CreatedAtUtc"));return result;
        });
    }
    private static String utc(ResultSet rs,String column) throws SQLException {
        LocalDateTime v=rs.getObject(column,LocalDateTime.class);return v==null?null:v.toInstant(ZoneOffset.UTC).toString();
    }
}

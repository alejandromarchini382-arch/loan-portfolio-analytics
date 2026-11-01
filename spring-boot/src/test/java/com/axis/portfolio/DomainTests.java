package com.axis.portfolio;
import com.axis.portfolio.dto.Responses.Meta;
import com.axis.portfolio.exception.ApiProblem;
import com.axis.portfolio.repository.PortfolioRepository;
import com.axis.portfolio.security.TenantRateLimit;
import com.axis.portfolio.service.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.util.*;
import static org.junit.jupiter.api.Assertions.*;
class DomainTests {
    static MultiValueMap<String,String> params(String... pairs) {
        var p=new LinkedMultiValueMap<String,String>();
        for(int i=0;i<pairs.length;i+=2)p.add(pairs[i],pairs[i+1]);return p;
    }
    @ParameterizedTest @CsvSource({"division,Division","loanOfficer,LoanOfficer","borrowerType,BorrowerType","riskRating,LoanRiskRating"})
    void dimensions(String name,String column) {
        assertEquals(column,ReportQuery.parse(ReportQuery.Kind.GROUPS,params("groupBy",name)).group().column);
    }
    @ParameterizedTest @ValueSource(strings={"loanRiskRating","Division","division; DROP TABLE Loans",""})
    void arbitraryIdentifiersRejected(String field) {
        assertThrows(ApiProblem.class,()->ReportQuery.parse(ReportQuery.Kind.GROUPS,params("groupBy",field)));
    }
    @ParameterizedTest @CsvSource({"tenantId,x","TenantId,x","sort,CurrentBalance","status,active","borrowerType,OTHER","riskRating,Unrated",
        "originationFrom,2026-02-30","originationFrom,0000-01-01","subgroupBy,division"})
    void invalidFilters(String key,String value) {
        assertThrows(ApiProblem.class,()->ReportQuery.parse(ReportQuery.Kind.GROUPS,params("groupBy","division",key,value)));
    }
    @ParameterizedTest @ValueSource(strings={"0","101","-1","abc","1.5"})
    void pageLimits(String limit) {
        assertThrows(ApiProblem.class,()->ReportQuery.parse(ReportQuery.Kind.LOANS,params("groupBy","division","groupKey","Commercial","limit",limit)));
    }
    @Test void fullPathsAndNullKeys() {
        var query=ReportQuery.parse(ReportQuery.Kind.LOANS,params("groupBy","division","groupKeyIsNull","true","subgroupBy","loanOfficer","subgroupKey","Demo Officer"));
        assertTrue(query.nullKey());assertEquals(50,query.limit());
        assertThrows(ApiProblem.class,()->ReportQuery.parse(ReportQuery.Kind.LOANS,params("groupBy","division","groupKey","x","groupKeyIsNull","true")));
        assertThrows(ApiProblem.class,()->ReportQuery.parse(ReportQuery.Kind.CHILDREN,params("groupBy","division","parentKey","x")));
        assertThrows(ApiProblem.class,()->ReportQuery.parse(ReportQuery.Kind.GROUPS,params("groupBy","division","originationFrom","2026-01-02","originationTo","2026-01-01")));
        var duplicate=params("groupBy","division");duplicate.add("groupBy","riskRating");
        assertThrows(ApiProblem.class,()->ReportQuery.parse(ReportQuery.Kind.GROUPS,duplicate));
    }
    @Test void decimalsDoNotLosePrecisionOrInventZeroRates() {
        assertEquals("9007199254740993.01",PortfolioRepository.decimal(new BigDecimal("9007199254740993.01"),2));
        assertEquals("0.07250000",PortfolioRepository.decimal(new BigDecimal("0.0725"),8));
        assertNull(PortfolioRepository.decimal(null,8));
    }
    @Test void cursorIsBoundToTenantFiltersPositionAndExpiry() {
        var json=new ObjectMapper();var now=Instant.parse("2026-10-31T00:00:00Z");
        var codec=new CursorCodec(json,TestSupport.CURSOR_KEY,10,Clock.fixed(now,ZoneOffset.UTC));
        var query=ReportQuery.parse(ReportQuery.Kind.LOANS,params("groupBy","division","groupKey","Commercial","limit","1"));
        var meta=new Meta(1,null,"2026-10-30T03:00:00Z");
        String cursor=codec.encode(TestSupport.A,query,meta,TestSupport.loan());
        var decoded=codec.decode(cursor,TestSupport.A,query);
        assertEquals("LN-000001",decoded.number());codec.checkVersion(decoded,meta);
        assertThrows(ApiProblem.class,()->codec.decode(cursor,TestSupport.B,query));
        var changed=ReportQuery.parse(ReportQuery.Kind.LOANS,params("groupBy","division","groupKey","Retail","limit","1"));
        assertThrows(ApiProblem.class,()->codec.decode(cursor,TestSupport.A,changed));
        String[] parts=cursor.split("\\.");
        String tampered=parts[0]+"."+(parts[1].startsWith("A")?"B":"A")+parts[1].substring(1);
        assertThrows(ApiProblem.class,()->codec.decode(tampered,TestSupport.A,query));
        var later=new CursorCodec(json,TestSupport.CURSOR_KEY,10,Clock.fixed(now.plusSeconds(11),ZoneOffset.UTC));
        assertThrows(ApiProblem.class,()->later.decode(cursor,TestSupport.A,query));
        assertEquals(409,assertThrows(ApiProblem.class,()->codec.checkVersion(decoded,new Meta(2,null,meta.asOfUtc()))).status());
        assertThrows(ApiProblem.class,()->codec.checkVersion(decoded,new Meta(1,TestSupport.B,meta.asOfUtc())));
        assertThrows(ApiProblem.class,()->codec.checkVersion(decoded,new Meta(1,null,"2026-10-31T00:00:00Z")));
    }
    @Test void limiterSeparatesTenantsAndConfigurationDoesNotPrintSecrets() {
        var limit=new TenantRateLimit(2,Clock.systemUTC());
        limit.check(TestSupport.A);limit.check(TestSupport.A);
        assertEquals(429,assertThrows(ApiProblem.class,()->limit.check(TestSupport.A)).status());
        limit.check(TestSupport.B);
        assertFalse(TestSupport.properties().toString().contains(TestSupport.JWT_KEY));
    }
}

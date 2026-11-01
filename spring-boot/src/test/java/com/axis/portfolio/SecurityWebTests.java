package com.axis.portfolio;
import com.axis.portfolio.config.PortfolioProperties;
import com.axis.portfolio.config.JsonLimits;
import com.axis.portfolio.controller.PortfolioController;
import com.axis.portfolio.dto.Responses.*;
import com.axis.portfolio.repository.PortfolioRepository;
import com.axis.portfolio.security.SecurityConfig;
import com.axis.portfolio.service.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.*;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@WebMvcTest(PortfolioController.class)
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
@Import({SecurityConfig.class,JsonLimits.class,PortfolioService.class,CursorCodec.class,SecurityWebTests.Properties.class})
class SecurityWebTests {
    @TestConfiguration static class Properties { @Bean PortfolioProperties settings() { return TestSupport.properties(); } }
    @Autowired MockMvc mvc;
    @MockitoBean PortfolioRepository repository;
    @MockitoBean RiskGateway risk;
    @BeforeEach void fixture() {
        when(repository.query(anyString(),any(),any())).thenReturn(new PortfolioRepository.Result(new Meta(1,null,"2026-10-30T03:00:00Z"),
            List.of(new Group(null,"Unassigned",1,"500.00",null,true)),List.of(TestSupport.loan())));
    }
    String bearer(String... permissions) throws Exception { return "Bearer "+TestSupport.token(TestSupport.A,List.of(permissions),""); }
    @Test void anonymousIsRejected() throws Exception {
        mvc.perform(get("/api/v1/portfolio/metadata")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        verifyNoInteractions(repository);
    }
    @ParameterizedTest @ValueSource(strings={"expired","signature","issuer","audience","algorithm","future","missing-exp","missing-iat","bad-permissions","bad-tenant","not-before"})
    void malformedOrInvalidTokens(String variant) throws Exception {
        String token=TestSupport.token(TestSupport.A,List.of("portfolio:read"),variant);
        mvc.perform(get("/api/v1/portfolio/metadata").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
        verifyNoInteractions(repository);
    }
    @Test void permissionBoundariesRemainIndependent() throws Exception {
        mvc.perform(get("/api/v1/portfolio/metadata").header("Authorization",bearer("portfolio:read"))).andExpect(status().isOk()).andExpect(jsonPath("$.maxDepth").value(2));
        mvc.perform(get("/api/v1/portfolio/metadata").header("Authorization",bearer("risk:read"))).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/portfolio/risk-runs").contentType("application/json").content("{}").header("Authorization",bearer("portfolio:read"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/portfolio/risk-runs/latest").header("Authorization",bearer("portfolio:read"))).andExpect(status().isForbidden());
        verifyNoInteractions(risk);
    }
    @Test void verifiedTenantAndNullableDecimalResponse() throws Exception {
        mvc.perform(get("/api/v1/portfolio/groups").param("groupBy","division").header("Authorization",bearer("portfolio:read")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.groups[0].key").doesNotExist()).andExpect(jsonPath("$.groups[0].totalBalance").value("500.00"))
            .andExpect(jsonPath("$.groups[0].averageInterestRate").doesNotExist()).andExpect(jsonPath("$.requestId").isString());
        verify(repository).query(eq(TestSupport.A),any(),isNull());
    }
    @Test void tenantOverrideAndSqlIdentifierInjectionAreRejected() throws Exception {
        mvc.perform(get("/api/v1/portfolio/groups").param("groupBy","division").param("tenantId",TestSupport.B).header("Authorization",bearer("portfolio:read"))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/portfolio/groups").param("groupBy","Division;DROP TABLE Loans").header("Authorization",bearer("portfolio:read"))).andExpect(status().isBadRequest());
        verifyNoInteractions(repository);
    }
    @Test void unauthorizedTenantIsForbidden() throws Exception {
        String token=TestSupport.token("00000000-0000-0000-0000-000000000001",List.of("portfolio:read"),"");
        mvc.perform(get("/api/v1/portfolio/metadata").header("Authorization","Bearer "+token)).andExpect(status().isForbidden());
        verifyNoInteractions(repository);
    }
    @Test void errorsAreSanitizedAndCorsIsExplicit() throws Exception {
        when(repository.query(anyString(),any(),any())).thenThrow(new DataAccessResourceFailureException("private SQL and credentials"));
        mvc.perform(get("/api/v1/portfolio/groups").param("groupBy","division").header("Authorization",bearer("portfolio:read")))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.error.code").value("DATABASE_UNAVAILABLE"));
        mvc.perform(options("/api/v1/portfolio/groups").header("Origin","https://untrusted.example").header("Access-Control-Request-Method","GET"))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("CORS_DENIED"));
        mvc.perform(options("/api/v1/portfolio/groups").header("Origin","http://localhost:8080").header("Access-Control-Request-Method","GET"))
            .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin","http://localhost:8080"));
    }
    @Test void riskSubmissionUsesTheVerifiedBearerWithoutTenantOverride() throws Exception {
        String token=bearer("risk:run");
        when(risk.submit(eq(TestSupport.A),eq(token),eq("request-one"),anyString())).thenReturn(Map.of("jobId",TestSupport.B,"status","QUEUED"));
        mvc.perform(post("/api/v1/portfolio/risk-runs").header("Authorization",token).header("Idempotency-Key","request-one")
            .contentType("application/json").content("{}")).andExpect(status().isAccepted()).andExpect(jsonPath("$.jobId").value(TestSupport.B));
        verify(risk).submit(eq(TestSupport.A),eq(token),eq("request-one"),anyString());
        mvc.perform(post("/api/v1/portfolio/risk-runs").header("Authorization",token).contentType("application/json").content("{\"tenantId\":\"other\"}"))
            .andExpect(status().isBadRequest());
    }
    @Test void oversizedRiskBodyIsRejected() throws Exception {
        mvc.perform(post("/api/v1/portfolio/risk-runs").header("Authorization",bearer("risk:run")).contentType("application/json").content(" ".repeat(2000)))
            .andExpect(status().isPayloadTooLarge());
    }
}

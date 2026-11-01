package com.axis.portfolio.controller;
import com.axis.portfolio.dto.Responses.*;
import com.axis.portfolio.exception.*;
import com.axis.portfolio.security.TenantContext;
import com.axis.portfolio.service.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/portfolio")
public class PortfolioController {
    private final PortfolioService portfolio; private final RiskGateway risk;
    public PortfolioController(PortfolioService portfolio,RiskGateway risk) { this.portfolio=portfolio;this.risk=risk; }
    @GetMapping("/metadata") public Map<String,Object> metadata(HttpServletRequest r) {
        if(!r.getParameterMap().isEmpty()) throw ApiProblem.bad("INVALID_PARAMETER");
        return portfolio.metadata();
    }
    @GetMapping("/groups") public GroupResponse groups(Authentication a,@RequestParam MultiValueMap<String,String> params,HttpServletRequest r) {
        return portfolio.groups(TenantContext.tenant(a),ReportQuery.Kind.GROUPS,params,ApiErrors.requestId(r));
    }
    @GetMapping("/groups/children") public GroupResponse children(Authentication a,@RequestParam MultiValueMap<String,String> params,HttpServletRequest r) {
        return portfolio.groups(TenantContext.tenant(a),ReportQuery.Kind.CHILDREN,params,ApiErrors.requestId(r));
    }
    @GetMapping("/loans") public LoanResponse loans(Authentication a,@RequestParam MultiValueMap<String,String> params,HttpServletRequest r) {
        return portfolio.loans(TenantContext.tenant(a),params,ApiErrors.requestId(r));
    }
    @PostMapping(value="/risk-runs",consumes=MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String,Object>> submit(Authentication a,@RequestHeader(value="Idempotency-Key",required=false) String key,
        @RequestBody Map<String,Object> body,HttpServletRequest r) {
        if(!r.getParameterMap().isEmpty() || body==null || !body.isEmpty()) throw ApiProblem.bad("INVALID_REQUEST");
        String bearer="Bearer "+((JwtAuthenticationToken)a).getToken().getTokenValue();
        return ResponseEntity.accepted().body(risk.submit(TenantContext.tenant(a),bearer,key,ApiErrors.requestId(r)));
    }
    @GetMapping("/risk-runs/latest") public Map<String,Object> latest(Authentication a,HttpServletRequest r) {
        if(!r.getParameterMap().isEmpty()) throw ApiProblem.bad("INVALID_PARAMETER");
        return risk.latest(TenantContext.tenant(a));
    }
    @GetMapping("/risk-runs/{job}") public Map<String,Object> status(Authentication a,@PathVariable String job,HttpServletRequest r) {
        if(!r.getParameterMap().isEmpty()) throw ApiProblem.bad("INVALID_PARAMETER");
        return risk.status(TenantContext.tenant(a),job,ApiErrors.requestId(r));
    }
}

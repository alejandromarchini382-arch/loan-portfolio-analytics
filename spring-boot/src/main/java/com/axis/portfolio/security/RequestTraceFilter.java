package com.axis.portfolio.security;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestTraceFilter extends OncePerRequestFilter {
    private final com.fasterxml.jackson.databind.ObjectMapper json;
    public RequestTraceFilter(com.fasterxml.jackson.databind.ObjectMapper json) { this.json=json; }
    private static final Logger LOG=LoggerFactory.getLogger(RequestTraceFilter.class);
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        String id=UUID.randomUUID().toString(); long start=System.nanoTime();
        request.setAttribute("requestId",id); response.setHeader("X-Request-Id",id);
        response.setHeader("Cache-Control","no-store");
        try {
            if("POST".equals(request.getMethod()) && request.getContentLengthLong()>1024) {
                com.axis.portfolio.exception.ApiErrors.write(json,request,response,413,"REQUEST_TOO_LARGE");return;
            }
            chain.doFilter(request,response);
        }
        finally {
            LOG.atInfo().addKeyValue("requestId",id).addKeyValue("tenantId",request.getAttribute("verifiedTenant"))
                .addKeyValue("status",response.getStatus()).addKeyValue("durationMs",(System.nanoTime()-start)/1000000).log("request_completed");
        }
    }
}

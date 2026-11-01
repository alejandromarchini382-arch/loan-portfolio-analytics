package com.axis.portfolio.security;
import com.axis.portfolio.config.PortfolioProperties;
import com.axis.portfolio.exception.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.*;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.authentication.*;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.*;
import org.springframework.web.filter.*;
@Configuration
public class SecurityConfig {
    public static final Set<String> PERMISSIONS=Set.of("portfolio:read","risk:read","risk:run");
    @Bean JwtDecoder jwtDecoder(PortfolioProperties p) {
        NimbusJwtDecoder decoder=NimbusJwtDecoder.withSecretKey(new SecretKeySpec(p.jwtSecret().getBytes(StandardCharsets.UTF_8),"HmacSHA256"))
            .macAlgorithm(MacAlgorithm.HS256).build();
        decoder.setJwtValidator(jwt->{
            try {
                Instant now=Instant.now();
                Object raw=jwt.getClaims().get("permissions");
                if(jwt.getExpiresAt()==null || !jwt.getExpiresAt().isAfter(now) || jwt.getIssuedAt()==null || jwt.getIssuedAt().isAfter(now)
                    || (jwt.getNotBefore()!=null && jwt.getNotBefore().isAfter(now))
                    || !p.issuer().equals(jwt.getClaimAsString("iss")) || !jwt.getAudience().contains(p.audience())
                    || jwt.getSubject()==null || jwt.getSubject().isBlank() || jwt.getSubject().length()>200
                    || PortfolioProperties.uuid(jwt.getClaimAsString("tenantId"))==null
                    || !(raw instanceof List<?> list) || list.isEmpty()
                    || list.stream().anyMatch(v-> !(v instanceof String) || !PERMISSIONS.contains(v)))
                    throw new IllegalArgumentException();
                return OAuth2TokenValidatorResult.success();
            } catch(RuntimeException ex) {
                return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token","Invalid authentication",null));
            }
        });
        return decoder;
    }
    @Bean SecurityFilterChain security(HttpSecurity http,PortfolioProperties p,ObjectMapper mapper) throws Exception {
        Converter<Jwt,AbstractAuthenticationToken> convert=jwt->new JwtAuthenticationToken(jwt,
            jwt.getClaimAsStringList("permissions").stream().map(SimpleGrantedAuthority::new).toList());
        CorsConfiguration cors=new CorsConfiguration();
        cors.setAllowedOrigins(p.corsOrigins()==null || p.corsOrigins().isBlank()?List.of():Arrays.stream(p.corsOrigins().split(",")).map(String::trim).toList());
        cors.setAllowedMethods(List.of("GET","POST","OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization","Content-Type","Idempotency-Key"));
        cors.setExposedHeaders(List.of("X-Request-Id")); cors.setAllowCredentials(false);
        UrlBasedCorsConfigurationSource source=new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/**",cors);
        CorsFilter corsFilter=new CorsFilter(source);
        corsFilter.setCorsProcessor(new DefaultCorsProcessor() {
            @Override protected void rejectRequest(org.springframework.http.server.ServerHttpResponse response) throws IOException {
                response.setStatusCode(org.springframework.http.HttpStatus.FORBIDDEN);
                response.getHeaders().setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
                String id=Optional.ofNullable(response.getHeaders().getFirst("X-Request-Id")).orElseGet(()->UUID.randomUUID().toString());
                mapper.writeValue(response.getBody(),ApiErrors.body("CORS_DENIED",id));
            }
        });
        TenantRateLimit limits=new TenantRateLimit(p.requestsPerMinute(),Clock.systemUTC());
        OncePerRequestFilter rateFilter=new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
                var auth=SecurityContextHolder.getContext().getAuthentication();
                if(auth instanceof JwtAuthenticationToken) {
                    String tenant=TenantContext.tenant(auth); request.setAttribute("verifiedTenant",tenant);
                    if(!p.tenantIds().contains(tenant)) { ApiErrors.write(mapper,request,response,403,"FORBIDDEN"); return; }
                    try { limits.check(tenant); }
                    catch(ApiProblem ex) { ApiErrors.write(mapper,request,response,ex.status(),ex.code()); return; }
                }
                chain.doFilter(request,response);
            }
        };
        http.csrf(c->c.disable()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .requestCache(c->c.disable()).formLogin(c->c.disable()).httpBasic(c->c.disable())
            .authorizeHttpRequests(a->a
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers(HttpMethod.POST,"/api/v1/portfolio/risk-runs").hasAuthority("risk:run")
                .requestMatchers("/api/v1/portfolio/risk-runs/**").hasAuthority("risk:read")
                .requestMatchers(HttpMethod.GET,"/api/v1/portfolio/**").hasAuthority("portfolio:read")
                .anyRequest().denyAll())
            .exceptionHandling(e->e.authenticationEntryPoint((r,s,x)->ApiErrors.write(mapper,r,s,401,"UNAUTHENTICATED"))
                .accessDeniedHandler((r,s,x)->ApiErrors.write(mapper,r,s,403,"FORBIDDEN")))
            .oauth2ResourceServer(o->o.jwt(j->j.jwtAuthenticationConverter(convert))
                .authenticationEntryPoint((r,s,x)->ApiErrors.write(mapper,r,s,401,"UNAUTHENTICATED")))
            .addFilterBefore(corsFilter,BearerTokenAuthenticationFilter.class)
            .addFilterAfter(rateFilter,BearerTokenAuthenticationFilter.class);
        return http.build();
    }
}

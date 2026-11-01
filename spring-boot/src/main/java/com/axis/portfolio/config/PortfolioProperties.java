package com.axis.portfolio.config;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
@ConfigurationProperties("portfolio")
@Validated
public record PortfolioProperties(String authMode,String jwtSecret,String issuer,String audience,String tenants,
    String cursorSecret,String dbHost,@Min(1) @Max(65535) int dbPort,String dbName,String dbUser,String dbPassword,
    boolean trustCertificate,@Min(1) @Max(30) int querySeconds,@Min(1) @Max(3600) int cursorSeconds,
    @Min(1) @Max(100000) int requestsPerMinute,String corsOrigins,String flaskBaseUrl) {
    public PortfolioProperties {
        if (!"development-jwt".equals(authMode) || !secret(jwtSecret) || !secret(cursorSecret) || blank(issuer)
            || blank(audience) || blank(tenants) || blank(dbHost) || !dbHost.matches("[A-Za-z0-9._-]+")
            || blank(dbName) || !dbName.matches("[A-Za-z][A-Za-z0-9_]{0,127}") || blank(dbUser)
            || "sa".equalsIgnoreCase(dbUser.trim()) || blank(dbPassword))
            throw new IllegalArgumentException("Invalid portfolio configuration; secrets and dedicated credentials are required");
        try {
            String[] ids=tenants.split(",",-1);
            if(ids.length>100) throw new IllegalArgumentException();
            for(String id:ids) uuid(id.trim());
            URI url=URI.create(flaskBaseUrl);
            if(!Set.of("http","https").contains(url.getScheme()) || url.getHost()==null || url.getUserInfo()!=null
                || url.getQuery()!=null || url.getFragment()!=null || !(url.getPath().isEmpty() || "/".equals(url.getPath())))
                throw new IllegalArgumentException();
            if(corsOrigins!=null && !corsOrigins.isBlank()) for(String origin:corsOrigins.split(",")) {
                URI o=URI.create(origin.trim());
                if(!Set.of("http","https").contains(o.getScheme()) || o.getHost()==null || o.getUserInfo()!=null
                    || !o.getPath().isEmpty() || o.getQuery()!=null || o.getFragment()!=null) throw new IllegalArgumentException();
            }
        } catch(RuntimeException ex) { throw new IllegalArgumentException("Invalid tenant, origin or Flask URL configuration"); }
    }
    public Set<String> tenantIds() { return Arrays.stream(tenants.split(",")).map(String::trim).map(PortfolioProperties::uuid).collect(Collectors.toUnmodifiableSet()); }
    public static String uuid(String value) {
        if(value==null || value.length()!=36) throw new IllegalArgumentException("Invalid UUID");
        String id=UUID.fromString(value).toString();
        if(!id.equalsIgnoreCase(value)) throw new IllegalArgumentException("Invalid UUID");
        return id;
    }
    private static boolean blank(String value) { return value==null || value.isBlank(); }
    private static boolean secret(String value) { return value!=null && value.getBytes(StandardCharsets.UTF_8).length>=32; }
    @Override public String toString() { return "PortfolioProperties[secrets=REDACTED]"; }
}

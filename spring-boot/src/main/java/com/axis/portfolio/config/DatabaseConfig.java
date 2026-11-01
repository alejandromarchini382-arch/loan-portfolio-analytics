package com.axis.portfolio.config;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
@Configuration
@org.springframework.boot.context.properties.EnableConfigurationProperties(PortfolioProperties.class)
public class DatabaseConfig {
    @Bean DataSource dataSource(PortfolioProperties p) {
        HikariConfig c=new HikariConfig();
        c.setJdbcUrl("jdbc:sqlserver://"+p.dbHost()+":"+p.dbPort()+";databaseName="+p.dbName()
            +";encrypt=true;trustServerCertificate="+p.trustCertificate()+";loginTimeout=5;sendStringParametersAsUnicode=false;applicationName=AxisPortfolio");
        c.setUsername(p.dbUser()); c.setPassword(p.dbPassword()); c.setMaximumPoolSize(5); c.setMinimumIdle(0);
        c.setConnectionTimeout(5000); c.setValidationTimeout(3000); c.setAutoCommit(true);
        return new HikariDataSource(c);
    }
}

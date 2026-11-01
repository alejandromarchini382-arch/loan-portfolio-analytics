package com.axis.portfolio.config;
import com.fasterxml.jackson.core.StreamReadConstraints;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.*;
@Configuration
public class JsonLimits {
    @Bean Jackson2ObjectMapperBuilderCustomizer jsonReadConstraints() {
        return builder->builder.postConfigurer(mapper->mapper.getFactory().setStreamReadConstraints(
            StreamReadConstraints.builder().maxDocumentLength(1024).maxStringLength(512).maxNestingDepth(5).build()));
    }
}

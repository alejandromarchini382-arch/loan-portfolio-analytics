package com.axis.portfolio.exception;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
public final class ApiErrors {
    private ApiErrors() {}
    public static String requestId(HttpServletRequest request) {
        Object id=request.getAttribute("requestId");
        return id==null?UUID.randomUUID().toString():id.toString();
    }
    public static Map<String,Object> body(String code,String id) {
        return Map.of("error",Map.of("code",code,"message",code.replace('_',' ').toLowerCase(java.util.Locale.ROOT),"requestId",id));
    }
    public static void write(ObjectMapper mapper,HttpServletRequest request,HttpServletResponse response,int status,String code) throws IOException {
        response.setStatus(status); response.setContentType("application/json");
        mapper.writeValue(response.getOutputStream(),body(code,requestId(request)));
    }
}

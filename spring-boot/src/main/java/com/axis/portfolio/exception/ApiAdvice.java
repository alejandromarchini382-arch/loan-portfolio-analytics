package com.axis.portfolio.exception;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.*;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
@RestControllerAdvice
public class ApiAdvice extends ResponseEntityExceptionHandler {
    @ExceptionHandler(ApiProblem.class) ResponseEntity<Object> problem(ApiProblem ex,HttpServletRequest request) {
        return ResponseEntity.status(ex.status()).body(ApiErrors.body(ex.code(),ApiErrors.requestId(request)));
    }
    @ExceptionHandler(DataAccessException.class) ResponseEntity<Object> database(DataAccessException ex,HttpServletRequest request) {
        return ResponseEntity.status(503).body(ApiErrors.body("DATABASE_UNAVAILABLE",ApiErrors.requestId(request)));
    }
    @ExceptionHandler(Exception.class) ResponseEntity<Object> unexpected(Exception ex,HttpServletRequest request) {
        return ResponseEntity.status(500).body(ApiErrors.body("INTERNAL_ERROR",ApiErrors.requestId(request)));
    }
    @Override protected ResponseEntity<Object> handleExceptionInternal(Exception ex,Object body,HttpHeaders headers,HttpStatusCode status,WebRequest request) {
        HttpServletRequest r=((ServletWebRequest)request).getRequest();
        return new ResponseEntity<>(ApiErrors.body("INVALID_REQUEST",ApiErrors.requestId(r)),headers,status);
    }
}

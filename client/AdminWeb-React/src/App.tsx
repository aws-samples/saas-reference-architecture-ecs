import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { CircularProgress, Box, Typography, Alert } from '@mui/material';
import Layout from './components/Layout/Layout';
import Dashboard from './pages/Dashboard/Dashboard';
import TenantList from './pages/Tenants/TenantList';
import TenantCreate from './pages/Tenants/TenantCreate';
import TenantDetail from './pages/Tenants/TenantDetail';
import AuthInfo from './pages/Auth/AuthInfo';
import AuthCallback from './components/Auth/AuthCallback';
import { useAuth } from './contexts/AuthContext';
import { apiService } from './services/api';

function App() {
  const { isAuthenticated, isLoading, login, getAccessToken, error, clearError } = useAuth();
  const location = useLocation();

  useEffect(() => {
    // Set up API service with token provider
    apiService.setTokenProvider(getAccessToken);
  }, [getAccessToken]);

  // 에러가 발생했을 때
  if (error) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100vh" gap={2}>
        <Alert severity="error" sx={{ maxWidth: 600 }}>
          <Typography variant="h6">Authentication Error</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {error.message || 'There was a problem with authentication.'}
          </Typography>
        </Alert>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <button onClick={clearError} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Clear Error
          </button>
          <button onClick={() => { clearError(); login(); }} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Try Again
          </button>
        </Box>
      </Box>
    );
  }

  // 로딩 중일 때
  if (isLoading) {
    return <AuthCallback />;
  }

  // 인증되지 않았을 때
  if (!isAuthenticated) {
    // URL에 인증 관련 파라미터가 있는지 확인 (Cognito 콜백)
    const urlParams = new URLSearchParams(window.location.search);
    const hasAuthParams = urlParams.has('code') || urlParams.has('state') || urlParams.has('error');
    
    // 해시 프래그먼트도 확인 (일부 OIDC 플로우에서 사용)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const hasHashAuthParams = hashParams.has('code') || hashParams.has('state') || hashParams.has('access_token');
    
    // 인증 파라미터가 없고 에러 페이지가 아닌 경우에만 로그인 리다이렉트
    if (!hasAuthParams && !hasHashAuthParams && !location.pathname.includes('error')) {
      // 약간의 지연을 두어 OIDC 라이브러리가 초기화될 시간을 줌
      setTimeout(() => {
        if (!isAuthenticated) {
          login();
        }
      }, 100);
    }
    
    return <AuthCallback />;
  }

  // 인증 완료 후 메인 애플리케이션
  return (
    <Routes>
      {/* 인증 콜백 처리 */}
      <Route path="/callback" element={<AuthCallback />} />
      <Route path="/signin-oidc" element={<AuthCallback />} />
      
      {/* 에러 페이지 */}
      <Route path="/error" element={
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
          <Alert severity="error">
            <Typography variant="h6">Authentication Error</Typography>
            <Typography>There was a problem with authentication. Please try again.</Typography>
          </Alert>
        </Box>
      } />
      
      {/* 메인 애플리케이션 라우트 */}
      <Route path="/*" element={
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/tenants" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tenants" element={<TenantList />} />
            <Route path="/tenants/create" element={<TenantCreate />} />
            <Route path="/tenants/:id" element={<TenantDetail />} />
            <Route path="/auth/info" element={<AuthInfo />} />
          </Routes>
        </Layout>
      } />
    </Routes>
  );
}

export default App;
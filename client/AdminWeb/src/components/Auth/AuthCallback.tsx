import React, { useEffect } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';

const AuthCallback: React.FC = () => {
  const { isLoading } = useAuth();

  useEffect(() => {
    // OIDC 콜백 처리는 react-oidc-context가 자동으로 처리
    // 로딩이 완료되면 App.tsx에서 자동으로 리다이렉트됨
  }, []);

  return (
    <Box 
      display="flex" 
      flexDirection="column"
      justifyContent="center" 
      alignItems="center" 
      minHeight="100vh"
      gap={2}
    >
      <CircularProgress size={60} />
      <Typography variant="h6" color="text.secondary">
        Processing authentication...
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Please wait while we complete your sign-in.
      </Typography>
    </Box>
  );
};

export default AuthCallback;
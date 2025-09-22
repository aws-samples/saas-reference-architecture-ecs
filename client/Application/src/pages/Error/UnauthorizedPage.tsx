import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Typography,
  TextField,
  Button,
  Alert,
  Container,
} from '@mui/material';
import {
  Home as HomeIcon,
} from '@mui/icons-material';
import { useTenant } from '../../contexts/TenantContext';
import { useNavigate } from 'react-router-dom';


const UnauthorizedPage: React.FC = () => {
  const { setTenantConfig } = useTenant();
  const navigate = useNavigate();
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if tenant is already configured (like Angular version)
    const storedTenantName = sessionStorage.getItem('app_tenantName');
    if (storedTenantName) {
      navigate('/dashboard');
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!tenantName.trim()) {
      setError('No tenant name provided.');
      return;
    }

    setLoading(true);

    try {
      console.log('Starting tenant configuration for:', tenantName.trim());
      
      // Same approach as Angular: set tenant config then immediately login to Cognito
      await setTenantConfig(tenantName.trim());
      
      console.log('Tenant config set successfully');
      console.log('Current sessionStorage:', {
        tenantName: sessionStorage.getItem('app_tenantName'),
        userPoolId: sessionStorage.getItem('app_userPoolId'),
        appClientId: sessionStorage.getItem('app_appClientId')
      });
      
      console.log('Tenant configured successfully. Authentication will be triggered automatically.');
      
      // State will be updated automatically through App.tsx useEffect
      
    } catch (err: any) {
      console.error('Error during tenant configuration:', err);
      setError(err.response?.data?.message || err.message || 'An unexpected error occurred!');
      setLoading(false);
    }
  };

  const isFormValid = tenantName.trim().length > 0;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Box component="form" onSubmit={handleSubmit}>
          <Card
            sx={{
              maxWidth: 500,
              mx: 'auto',
              borderRadius: 3,
              boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <CardContent sx={{ p: 4 }}>
              <Typography 
                variant="h4" 
                component="h1" 
                gutterBottom 
                align="center"
                sx={{ 
                  fontWeight: 600,
                  color: '#2c3e50',
                  mb: 1
                }}
              >
                Tenant Name
              </Typography>
              
              <Typography 
                variant="body1" 
                color="text.secondary" 
                align="center" 
                sx={{ mb: 4 }}
              >
                Enter your tenant name and click submit below
              </Typography>

              {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                  {error}
                </Alert>
              )}

              <TextField
                fullWidth
                label="Tenant Name"
                placeholder="Enter Tenant Name"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                required
                variant="outlined"
                sx={{ mb: 3 }}
                InputProps={{
                  endAdornment: <HomeIcon sx={{ color: 'text.secondary' }} />,
                }}
              />

              <CardActions sx={{ p: 0 }}>
                <Box sx={{ width: '100%', textAlign: 'center' }}>
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    disabled={!isFormValid || loading}
                    sx={{
                      px: 4,
                      py: 1.5,
                      fontSize: '1rem',
                      fontWeight: 600,
                      borderRadius: 2,
                      textTransform: 'none',
                    }}
                  >
                    {loading ? 'Submitting...' : 'Submit'}
                  </Button>
                </Box>
              </CardActions>
            </CardContent>
          </Card>
        </Box>
      </Container>
    </Box>
  );
};

export default UnauthorizedPage;
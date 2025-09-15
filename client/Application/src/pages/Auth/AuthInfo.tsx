import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  Grid,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useTenant } from '../../contexts/TenantContext';

// JWT Token Utilities
interface DecodedJWT {
  header: any;
  payload: any;
  signature: string;
  raw: {
    header: string;
    payload: string;
    signature: string;
  };
}

const decodeJWT = (token: string): DecodedJWT | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Base64 URL decode function
    const base64UrlDecode = (str: string): string => {
      // Add padding if needed
      let padded = str;
      while (padded.length % 4) {
        padded += '=';
      }
      // Replace URL-safe characters
      padded = padded.replace(/-/g, '+').replace(/_/g, '/');
      return atob(padded);
    };

    // Decode header and payload
    const headerJson = base64UrlDecode(headerB64);
    const payloadJson = base64UrlDecode(payloadB64);

    return {
      header: JSON.parse(headerJson),
      payload: JSON.parse(payloadJson),
      signature: signatureB64,
      raw: {
        header: headerB64,
        payload: payloadB64,
        signature: signatureB64,
      },
    };
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
};



const AuthInfo: React.FC = () => {
  const { user } = useAuthenticator();
  const { tenant } = useTenant();

  return (
    <div className="page-container">
      <div className="container">
        <div>
          <Typography variant="h4" className="page-title">
            Authentication Information
          </Typography>
          <Typography variant="body2" className="page-subtitle">
            View detailed authentication tokens and user profile information
          </Typography>
        </div>
        
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card 
              sx={{
                border: 0,
                bgcolor: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(12px)',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                minHeight: 400,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  User Profile
                </Typography>
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Subject (User ID)
                  </Typography>
                  <Typography variant="body1">
                    {user?.username || 'N/A'}
                  </Typography>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Email
                  </Typography>
                  <Typography variant="body1">
                    {user?.attributes?.email || 'N/A'}
                  </Typography>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Preferred Username
                  </Typography>
                  <Typography variant="body1">
                    {user?.username || 'N/A'}
                  </Typography>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Email Verified
                  </Typography>
                  <Chip 
                    label={user?.attributes?.email_verified ? 'Verified' : 'Not Verified'} 
                    color={user?.attributes?.email_verified ? 'success' : 'warning'} 
                    variant="outlined" 
                    size="small"
                  />
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Authentication Status
                  </Typography>
                  <Chip 
                    label="Authenticated" 
                    color="success" 
                    variant="outlined" 
                    size="small"
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card 
              sx={{
                border: 0,
                bgcolor: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(12px)',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                minHeight: 300,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Tenant Information
                </Typography>
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Tenant ID
                  </Typography>
                  <Typography variant="body1">
                    {tenant?.id || 'N/A'}
                  </Typography>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Tenant Name
                  </Typography>
                  <Typography variant="body1">
                    {tenant?.name || 'N/A'}
                  </Typography>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Tier
                  </Typography>
                  <Chip 
                    label={tenant?.tier?.toUpperCase() || 'N/A'} 
                    color="primary" 
                    variant="outlined" 
                    size="small"
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* ID Token Analysis */}
          <Grid item xs={12} md={6}>
            <Card 
              sx={{
                border: 0,
                bgcolor: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(12px)',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                minHeight: 500,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  ID Token Analysis
                </Typography>
                
                {user?.getSignInUserSession()?.getIdToken()?.getJwtToken() ? (
                  <>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Raw Token
                      </Typography>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontFamily: 'monospace', 
                          fontSize: '0.75rem', 
                          wordBreak: 'break-all',
                          bgcolor: 'rgba(0, 0, 0, 0.05)',
                          p: 1,
                          borderRadius: 1,
                          maxHeight: '100px',
                          overflow: 'auto'
                        }}
                      >
                        {user.getSignInUserSession()?.getIdToken()?.getJwtToken()}
                      </Typography>
                    </Box>

                    {(() => {
                      const decoded = decodeJWT(user.getSignInUserSession()?.getIdToken()?.getJwtToken() || '');
                      return decoded ? (
                        <>
                          <Accordion sx={{ mb: 1, bgcolor: 'transparent', boxShadow: 'none' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2" fontWeight="medium">Header</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Typography 
                                variant="body2" 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: '0.75rem',
                                  whiteSpace: 'pre-wrap',
                                  bgcolor: 'rgba(0, 0, 0, 0.05)',
                                  p: 1,
                                  borderRadius: 1,
                                  overflow: 'auto'
                                }}
                              >
                                {JSON.stringify(decoded.header, null, 2)}
                              </Typography>
                            </AccordionDetails>
                          </Accordion>

                          <Accordion sx={{ mb: 1, bgcolor: 'transparent', boxShadow: 'none' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2" fontWeight="medium">Payload</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Typography 
                                variant="body2" 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: '0.75rem',
                                  whiteSpace: 'pre-wrap',
                                  bgcolor: 'rgba(0, 0, 0, 0.05)',
                                  p: 1,
                                  borderRadius: 1,
                                  overflow: 'auto'
                                }}
                              >
                                {JSON.stringify(decoded.payload, null, 2)}
                              </Typography>
                            </AccordionDetails>
                          </Accordion>

                          <Accordion sx={{ bgcolor: 'transparent', boxShadow: 'none' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2" fontWeight="medium">Signature</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: '0.75rem',
                                  wordBreak: 'break-all',
                                  bgcolor: 'rgba(0, 0, 0, 0.05)',
                                  p: 1,
                                  borderRadius: 1
                                }}
                              >
                                {decoded.signature}
                              </Typography>
                            </AccordionDetails>
                          </Accordion>
                        </>
                      ) : (
                        <Typography variant="body2" color="error">
                          Failed to decode ID token
                        </Typography>
                      );
                    })()}
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No ID token available
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Access Token Analysis */}
          <Grid item xs={12} md={6}>
            <Card 
              sx={{
                border: 0,
                bgcolor: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(12px)',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                minHeight: 500,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Access Token Analysis
                </Typography>
                
                {user?.getSignInUserSession()?.getAccessToken()?.getJwtToken() ? (
                  <>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Raw Token
                      </Typography>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontFamily: 'monospace', 
                          fontSize: '0.75rem', 
                          wordBreak: 'break-all',
                          bgcolor: 'rgba(0, 0, 0, 0.05)',
                          p: 1,
                          borderRadius: 1,
                          maxHeight: '100px',
                          overflow: 'auto'
                        }}
                      >
                        {user.getSignInUserSession()?.getAccessToken()?.getJwtToken()}
                      </Typography>
                    </Box>

                    {(() => {
                      const decoded = decodeJWT(user.getSignInUserSession()?.getAccessToken()?.getJwtToken() || '');
                      return decoded ? (
                        <>
                          <Accordion sx={{ mb: 1, bgcolor: 'transparent', boxShadow: 'none' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2" fontWeight="medium">Header</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Typography 
                                variant="body2" 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: '0.75rem',
                                  whiteSpace: 'pre-wrap',
                                  bgcolor: 'rgba(0, 0, 0, 0.05)',
                                  p: 1,
                                  borderRadius: 1,
                                  overflow: 'auto'
                                }}
                              >
                                {JSON.stringify(decoded.header, null, 2)}
                              </Typography>
                            </AccordionDetails>
                          </Accordion>

                          <Accordion sx={{ mb: 1, bgcolor: 'transparent', boxShadow: 'none' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2" fontWeight="medium">Payload</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Typography 
                                variant="body2" 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: '0.75rem',
                                  whiteSpace: 'pre-wrap',
                                  bgcolor: 'rgba(0, 0, 0, 0.05)',
                                  p: 1,
                                  borderRadius: 1,
                                  overflow: 'auto'
                                }}
                              >
                                {JSON.stringify(decoded.payload, null, 2)}
                              </Typography>
                            </AccordionDetails>
                          </Accordion>

                          <Accordion sx={{ bgcolor: 'transparent', boxShadow: 'none' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2" fontWeight="medium">Signature</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: '0.75rem',
                                  wordBreak: 'break-all',
                                  bgcolor: 'rgba(0, 0, 0, 0.05)',
                                  p: 1,
                                  borderRadius: 1
                                }}
                              >
                                {decoded.signature}
                              </Typography>
                            </AccordionDetails>
                          </Accordion>
                        </>
                      ) : (
                        <Typography variant="body2" color="error">
                          Failed to decode Access token
                        </Typography>
                      );
                    })()}
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No Access token available
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </div>
    </div>
  );
};

export default AuthInfo;
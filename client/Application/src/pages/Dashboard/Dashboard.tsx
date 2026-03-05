import React, { useState } from 'react';
import {
  Grid, Card, CardContent, Typography, Box, Paper,
  Button, Chip, CircularProgress, Divider, Alert,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import {
  Inventory as InventoryIcon,
  ShoppingCart as ShoppingCartIcon,
  TrendingUp as TrendingUpIcon,
  People as PeopleIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayArrowIcon,
  AdminPanelSettings as AdminPanelSettingsIcon,
} from '@mui/icons-material';
import { useAuth } from 'react-oidc-context';
import { useTenant } from '../../contexts/TenantContext';
import { environment } from '../../config/environment';
import {
  FOSSACORE_APIS, FOSSAADMIN_APIS, FossaApiEndpoint, callFossaApi,
} from '../../services/fossaService';

const METHOD_COLORS: Record<string, 'success' | 'primary' | 'warning' | 'error'> = {
  GET: 'success', POST: 'primary', PUT: 'warning', DELETE: 'error',
};

interface ApiResult {
  loading: boolean;
  data?: any;
  error?: string;
}

const ApiPanel: React.FC<{ title: string; endpoints: FossaApiEndpoint[] }> = ({ title, endpoints }) => {
  const [results, setResults] = useState<Record<string, ApiResult>>({});

  const handleCall = async (ep: FossaApiEndpoint): Promise<void> => {
    const key = `${ep.service}${ep.path}`;
    setResults((prev: Record<string, ApiResult>) => ({ ...prev, [key]: { loading: true } }));
    try {
      const data = await callFossaApi(ep);
      setResults((prev: Record<string, ApiResult>) => ({ ...prev, [key]: { loading: false, data } }));
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.message || e?.response?.data || e?.message || 'Error';
      const detail = status ? `[${status}] ${msg}` : msg;
      setResults((prev: Record<string, ApiResult>) => ({ ...prev, [key]: { loading: false, error: detail } }));
    }
  };

  return (
    <Accordion defaultExpanded>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1" fontWeight="bold">{title}</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {endpoints.map((ep) => {
          const key = `${ep.service}${ep.path}`;
          const result = results[key];
          return (
            <Box key={key} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Chip label={ep.method} color={METHOD_COLORS[ep.method]} size="small" sx={{ minWidth: 52, fontWeight: 'bold' }} />
                <Typography variant="body2" fontFamily="monospace" sx={{ flex: 1 }}>
                  {ep.path}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {ep.description}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={result?.loading ? <CircularProgress size={12} /> : <PlayArrowIcon />}
                  onClick={() => handleCall(ep)}
                  disabled={result?.loading}
                >
                  Call
                </Button>
              </Box>
              {result && !result.loading && (
                <Box sx={{ mt: 1 }}>
                  {result.error ? (
                    <Alert severity="error" sx={{ py: 0 }}>{result.error}</Alert>
                  ) : (
                    <Box
                      component="pre"
                      sx={{
                        bgcolor: 'grey.100', borderRadius: 1, p: 1,
                        fontSize: 11, overflow: 'auto', maxHeight: 150, m: 0,
                      }}
                    >
                      {JSON.stringify(result.data, null, 2)}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </AccordionDetails>
    </Accordion>
  );
};

const Dashboard: React.FC = () => {
  const { tenant } = useTenant();
  const auth = useAuth();

  const handleOpenFossaAdmin = (): void => {
    const token = auth.user?.id_token;
    if (!token) {
      alert('No auth token found. Please log in again.');
      return;
    }
    const base = environment.apiUrl.replace(/\/$/, '');
    window.open(`${base}/fossaadmin/login?_jwt=${encodeURIComponent(token)}`, '_blank');
  };

  const stats = [
    { title: 'Total Products', value: '24', icon: <InventoryIcon />, color: '#1976d2' },
    { title: 'Total Orders', value: '156', icon: <ShoppingCartIcon />, color: '#2e7d32' },
    { title: 'Active Users', value: '8', icon: <PeopleIcon />, color: '#ed6c02' },
    { title: 'Revenue Growth', value: '+12%', icon: <TrendingUpIcon />, color: '#9c27b0' },
  ];

  return (
    <Box>
      <Typography variant="h4" className="page-title">Dashboard</Typography>
      <Typography variant="body2" className="page-subtitle">
        Monitor your SaaS platform performance and business metrics
      </Typography>

      {tenant?.tier ? (
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Welcome to {tenant.name} ({tenant.tier} tier)
        </Typography>
      ) : (
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Welcome to {tenant?.name}
        </Typography>
      )}

      <Grid container spacing={3} sx={{ mt: 2 }}>
        {stats.map((stat, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card className="dashboard-card card-with-top-border">
              <CardContent className="dashboard-card-content">
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ backgroundColor: stat.color, color: 'white', borderRadius: 1, p: 1, mr: 2, display: 'flex', alignItems: 'center' }}>
                    {stat.icon}
                  </Box>
                  <Typography variant="h6">{stat.title}</Typography>
                </Box>
                <Typography variant="h4" color={stat.color}>{stat.value}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Box sx={{ mt: 4 }}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>Recent Activity</Typography>
          <Typography variant="body2" color="text.secondary">• New order #1234 created</Typography>
          <Typography variant="body2" color="text.secondary">• Product "Widget A" updated</Typography>
          <Typography variant="body2" color="text.secondary">• User "[email]" registered</Typography>
        </Paper>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Paper sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">Billing Admin Console</Typography>
            <Typography variant="body2" color="text.secondary">
              Open FOSSA Billing admin console in a new tab
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AdminPanelSettingsIcon />}
            onClick={handleOpenFossaAdmin}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Open Admin Console
          </Button>
        </Paper>
      </Box>

      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" gutterBottom>Fossa API Test</Typography>
        <Divider sx={{ mb: 2 }} />
        <ApiPanel title="fossacore API" endpoints={FOSSACORE_APIS} />
        <Box sx={{ mt: 1 }} />
        <ApiPanel title="fossaadmin API" endpoints={FOSSAADMIN_APIS} />
      </Box>
    </Box>
  );
};

export default Dashboard;

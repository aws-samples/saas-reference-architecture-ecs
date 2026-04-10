import React, { useState } from 'react';
import {
  Grid, Card, CardContent, Typography, Box, Paper,
  Button, Chip, CircularProgress, Alert, Accordion,
  AccordionSummary, AccordionDetails, TextField,
} from '@mui/material';
import {
  Inventory as InventoryIcon,
  ShoppingCart as ShoppingCartIcon,
  TrendingUp as TrendingUpIcon,
  People as PeopleIcon,
  Pets as PetsIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayIcon,
  Api as ApiIcon,
} from '@mui/icons-material';
import { useAuth } from 'react-oidc-context';
import { useTenant } from '../../contexts/TenantContext';
import { environment } from '../../config/environment';
import { httpClient } from '../../services/httpClient';

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  sampleBody?: string;
}

interface ApiService {
  name: string;
  endpoints: ApiEndpoint[];
}

const API_SERVICES: ApiService[] = [
  {
    name: 'Orders',
    endpoints: [
      { method: 'GET', path: '/orders', description: 'List all orders' },
      { method: 'POST', path: '/orders', description: 'Create an order', sampleBody: '{"orderName":"Order-001","orderProducts":[{"productName":"Widget","price":10,"quantity":2}]}' },
    ],
  },
  {
    name: 'Products',
    endpoints: [
      { method: 'GET', path: '/products', description: 'List all products' },
      { method: 'POST', path: '/products', description: 'Create a product', sampleBody: '{"name":"Widget A","price":29.99,"sku":"WA-001","category":"Electronics"}' },
    ],
  },
];

const methodColor = (m: string) => {
  switch (m) {
    case 'GET': return 'success';
    case 'POST': return 'primary';
    case 'PUT': return 'warning';
    case 'DELETE': return 'error';
    default: return 'default';
  }
};

const ApiTestPanel: React.FC<{ endpoint: ApiEndpoint }> = ({ endpoint }) => {
  const [response, setResponse] = useState<string>('');
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState(endpoint.sampleBody || '');

  const baseUrl = environment.apiUrl.replace(/\/$/, '');

  const handleCall = async () => {
    setLoading(true);
    setResponse('');
    setStatus(null);
    try {
      let res;
      const url = `${baseUrl}${endpoint.path}`;
      switch (endpoint.method) {
        case 'GET': res = await httpClient.get(url); break;
        case 'POST': res = await httpClient.post(url, JSON.parse(body)); break;
        case 'PUT': res = await httpClient.put(url, JSON.parse(body)); break;
        case 'DELETE': res = await httpClient.delete(url); break;
      }
      setStatus(res.status);
      setResponse(JSON.stringify(res.data, null, 2));
    } catch (err: any) {
      setStatus(err.response?.status || 0);
      setResponse(err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1, borderBottom: '1px solid #eee' }}>
      <Chip label={endpoint.method} color={methodColor(endpoint.method) as any} size="small" sx={{ minWidth: 70, fontWeight: 600 }} />
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{endpoint.path}</Typography>
        <Typography variant="caption" color="text.secondary">{endpoint.description}</Typography>
        {endpoint.sampleBody && (
          <TextField
            size="small" fullWidth multiline rows={2} sx={{ mt: 1, '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
            value={body} onChange={(e) => setBody(e.target.value)}
          />
        )}
        {response && (
          <Box sx={{ mt: 1 }}>
            <Chip label={`${status}`} size="small" color={status && status < 400 ? 'success' : 'error'} sx={{ mb: 0.5 }} />
            <Box sx={{ backgroundColor: '#f5f5f5', p: 1, borderRadius: 1, maxHeight: 200, overflow: 'auto' }}>
              <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>{response}</pre>
            </Box>
          </Box>
        )}
      </Box>
      <Button variant="outlined" size="small" startIcon={loading ? <CircularProgress size={14} /> : <PlayIcon />}
        onClick={handleCall} disabled={loading} sx={{ minWidth: 80 }}>
        Call
      </Button>
    </Box>
  );
};

const Dashboard: React.FC = () => {
  const { tenant } = useTenant();
  const auth = useAuth();

  const handleOpenPetclinic = (): void => {
    const token = auth.user?.id_token;
    if (!token) { alert('No auth token found.'); return; }
    const base = environment.apiUrl.replace(/\/$/, '');
    window.open(`${base}/sso-entry?_jwt=${encodeURIComponent(token)}`, '_blank');
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

      {/* API Test Panel */}
      <Box sx={{ mt: 4 }}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <ApiIcon sx={{ mr: 1, color: '#1976d2' }} />
            <Typography variant="h6">API Endpoints</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Test your service APIs directly. Requests include your Cognito JWT token automatically.
          </Typography>
          {API_SERVICES.map((service) => (
            <Accordion key={service.name} defaultExpanded={service.name.includes('Tutorials')}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>{service.name}</Typography>
                <Chip label={`${service.endpoints.length} endpoints`} size="small" sx={{ ml: 1 }} />
              </AccordionSummary>
              <AccordionDetails>
                {service.endpoints.map((ep, i) => (
                  <ApiTestPanel key={`${ep.method}-${ep.path}-${i}`} endpoint={ep} />
                ))}
              </AccordionDetails>
            </Accordion>
          ))}
        </Paper>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Paper sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">Petclinic Application</Typography>
            <Typography variant="body2" color="text.secondary">
              Open Spring Petclinic (JSP) in a new tab
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<PetsIcon />} onClick={handleOpenPetclinic} sx={{ whiteSpace: 'nowrap' }}>
            Open Petclinic
          </Button>
        </Paper>
      </Box>
    </Box>
  );
};

export default Dashboard;

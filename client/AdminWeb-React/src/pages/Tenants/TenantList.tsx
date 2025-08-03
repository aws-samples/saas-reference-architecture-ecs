import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Chip,
  IconButton,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  FindInPageOutlined as FindInPageOutlinedIcon,
  DeleteOutlined as DeleteOutlinedIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Tenant } from '../../models/tenant';
import tenantService from '../../services/tenantService';
import DeleteTenantDialog from '../../components/DeleteTenantDialog';
import PageHeader from '../../components/common/PageHeader';
import "../../styles/index.css";

const TenantList: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; tenant: Tenant | null }>({
    open: false,
    tenant: null,
  });
  const navigate = useNavigate();

  useEffect(() => {
    loadTenants();
  }, []);

  const loadTenants = async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedTenants = await tenantService.fetchTenants();
      console.log('Fetched tenants:', fetchedTenants); // 디버깅용 로그
      setTenants(fetchedTenants);
    } catch (err) {
      setError('Failed to load tenants');
      console.error('Error loading tenants:', err);
    } finally {
      setLoading(false);
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'basic':
        return 'default';
      case 'advanced':
        return 'primary';
      case 'premium':
        return 'secondary';
      default:
        return 'default';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'complete':
      case 'active':
      case 'success':
        return 'success';
      case 'failed':
      case 'error':
      case 'inactive':
        return 'error';
      case 'in_progress':
      case 'in progress':
      case 'pending':
      case 'processing':
        return 'warning';
      default:
        return 'default';
    }
  };

  const handleDeleteTenant = (tenant: Tenant) => {
    setDeleteDialog({ open: true, tenant });
  };

  const confirmDelete = async () => {
    if (deleteDialog.tenant) {
      try {
        await tenantService.deleteTenant(deleteDialog.tenant);
        setTenants(tenants.filter(t => t.tenantId !== deleteDialog.tenant!.tenantId));
        setDeleteDialog({ open: false, tenant: null });
      } catch (err) {
        setError('Failed to delete tenant');
        console.error('Error deleting tenant:', err);
      }
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <div className="page-container">
      <div className="container">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
          <div>
            <Typography variant="h4" className="page-title">
              Tenants
            </Typography>
            <Typography variant="body2" className="page-subtitle">
              Manage and monitor all tenant organizations in your SaaS platform
            </Typography>
          </div>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/tenants/create')}
            className="tenant-create-button"
          >
            Create Tenant
          </Button>
        </Box>

      {error && (
        <Alert severity="error" className="error-alert" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {tenants.map((tenant: any, index) => {
          // 실제 API 응답 구조에 맞게 데이터 추출
          const tenantId = tenant.tenantId || tenant.id || `tenant-${index}`;
          const tenantName = tenant.tenantData?.tenantName || tenant.tenantName || tenant.name || 'Unknown Tenant';
          const email = tenant.tenantData?.email || tenant.email || 'No email';
          const tier = tenant.tenantData?.tier || tenant.tier || 'unknown';
          // 더 많은 상태 필드 확인
          const status = tenant.tenantRegistrationData?.registrationStatus || 
                        tenant.registrationStatus || 
                        tenant.status || 
                        tenant.state ||
                        tenant.tenantStatus ||
                        'complete'; // 기본값을 'complete'로 변경
          
          return (
            <Grid item xs={12} sm={6} md={4} key={tenantId}>
              <Card className="glass-card tenant-card">
                <CardContent>
                  <div className="tenant-card-header">
                    <Typography variant="h6" component="div" className="tenant-card-title">
                      {tenantName}
                    </Typography>
                    <div className="tenant-card-actions">
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/tenants/${tenantId}`, {
                          state: {
                            tenantName,
                            email,
                            tier,
                            tenantRegistrationId: tenant.tenantRegistrationData?.tenantRegistrationId || tenant.tenantRegistrationId || tenant.id
                          }
                        })}
                        sx={{ color: '#e9710c', mr: 0 }}
                      >
                        <FindInPageOutlinedIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteTenant(tenant)}
                        sx={{ color: '#6b7280' }}
                      >
                        <DeleteOutlinedIcon />
                      </IconButton>
                    </div>
                  </div>

                  <Typography variant="body2" className="tenant-card-email">
                    {email}
                  </Typography>

                  <div className="tenant-card-chips">
                    <Chip
                      label={tier.toUpperCase()}
                      color={getTierColor(tier.toLowerCase()) as any}
                      size="small"
                    />
                    <Chip
                      label={status.toUpperCase()}
                      color={getStatusColor(status.toLowerCase()) as any}
                      size="small"
                    />
                  </div>

                  <Typography variant="body2" className="tenant-card-id">
                    ID: {tenantId}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

        <DeleteTenantDialog
          open={deleteDialog.open}
          onClose={() => setDeleteDialog({ open: false, tenant: null })}
          onConfirm={confirmDelete}
          tenantName={
            deleteDialog.tenant?.tenantData?.tenantName || 
            (deleteDialog.tenant as any)?.tenantName || 
            (deleteDialog.tenant as any)?.name || 
            'Unknown Tenant'
          }
        />
      </div>
    </div>
  );
};

export default TenantList;
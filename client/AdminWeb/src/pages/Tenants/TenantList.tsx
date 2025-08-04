import React, { useState, useEffect, useCallback } from 'react';
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
import DeleteTenantDialog from '../../components/DeleteTenantDialog';

import { useTenants } from '../../hooks/useTenants';
import { TIER_COLORS, STATUS_COLORS } from '../../constants/pricing';
import { COMMON_STYLES } from '../../constants/styles';
import "../../styles/index.css";

const TenantList: React.FC = () => {
  const { tenants, loading, error, loadTenants, deleteTenant } = useTenants();
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; tenant: Tenant | null }>({
    open: false,
    tenant: null,
  });
  const navigate = useNavigate();

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  const getTierColor = useCallback((tier: string) => {
    return TIER_COLORS[tier.toLowerCase() as keyof typeof TIER_COLORS] || 'default';
  }, []);

  const getStatusColor = useCallback((status: string) => {
    return STATUS_COLORS[status.toLowerCase() as keyof typeof STATUS_COLORS] || 'default';
  }, []);

  const handleDeleteTenant = useCallback((tenant: Tenant) => {
    setDeleteDialog({ open: true, tenant });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (deleteDialog.tenant) {
      try {
        await deleteTenant(deleteDialog.tenant);
        setDeleteDialog({ open: false, tenant: null });
      } catch (error) {
        // Error is handled by the hook
      }
    }
  }, [deleteDialog.tenant, deleteTenant]);

  if (loading) {
    return (
      <Box sx={COMMON_STYLES.loadingContainer}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <div className="page-container">
      <div className="container">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', ...COMMON_STYLES.marginBottom4 }}>
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
        <Alert severity="error" className="error-alert" sx={COMMON_STYLES.marginBottom3}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {tenants.map((tenant: Tenant & Record<string, any>, index) => {
          // Extract data according to actual API response structure
          const tenantId = tenant.tenantId || tenant.id || `tenant-${index}`;
          const tenantName = tenant.tenantData?.tenantName || tenant.tenantName || tenant.name || 'Unknown Tenant';
          const email = tenant.tenantData?.email || tenant.email || 'No email';
          const tier = tenant.tenantData?.tier || tenant.tier || 'unknown';
          // Check more status fields
          const status = tenant.tenantRegistrationData?.registrationStatus || 
                        tenant.registrationStatus || 
                        tenant.status || 
                        tenant.state ||
                        tenant.tenantStatus ||
                        'complete'; // Default value changed to 'complete'
          
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
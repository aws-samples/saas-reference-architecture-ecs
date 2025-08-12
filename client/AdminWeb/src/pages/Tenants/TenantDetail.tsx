import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Grid,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Delete as DeleteIcon } from '@mui/icons-material';
import { TenantRegistrationData } from '../../models/tenant';
import tenantService from '../../services/tenantService';
import DeleteTenantDialog from '../../components/DeleteTenantDialog';

const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [tenant, setTenant] = useState<TenantRegistrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchTenant = async (tenantId: string) => {
    try {
      setLoading(true);
      setError(null);
      
      // Use tenantRegistrationId from navigation state if available
      const tenantRegistrationId = location.state?.tenantRegistrationId || tenantId;
      console.log('Fetching tenant with ID:', tenantRegistrationId);
      
      const tenantData = await tenantService.getTenant(tenantRegistrationId);
      setTenant(tenantData);
    } catch (err) {
      setError('Failed to fetch tenant details');
      console.error('Error fetching tenant:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchTenant(id);
    }
  }, [id]);



  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'deleted':
        return 'error';
      case 'created':
      case 'complete':
        return 'success';
      case 'in progress':
      case 'inprogress':
      case 'provisioning':
        return 'info';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const handleDelete = async () => {
    if (!tenant || !id) return;
    
    try {
      setDeleting(true);
      setError(null);
      
      // Construct tenant object like Angular version
      const tenantToDelete = {
        tenantId: id,
        tenantData: {
          tenantName: location.state?.tenantName || '',
          email: location.state?.email || '',
          tier: location.state?.tier || 'basic'
        },
        tenantRegistrationData: {
          tenantRegistrationId: tenant.tenantRegistrationId,
          registrationStatus: tenant.registrationStatus
        }
      };
      
      console.log('Deleting tenant:', tenantToDelete);
      console.log('API URL:', `/tenant-registrations/${tenant.tenantRegistrationId}`);
      
      const result = await tenantService.deleteTenant(tenantToDelete);
      console.log('Delete result:', result);
      
      navigate('/tenants');
    } catch (err: any) {
      console.error('Delete error details:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
        url: err.config?.url
      });
      setError(`Failed to delete tenant: ${err.response?.data?.message || err.message}`);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <Box className="loading-container">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        {error}
      </Alert>
    );
  }

  if (!tenant) {
    return (
      <Alert severity="error">
        Tenant not found
      </Alert>
    );
  }

  return (
    <>
      <div className="page-container">
        <div className="container">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
            <div>
              <Typography variant="h4" className="page-title">
                Tenant Details
              </Typography>
              <Typography variant="body2" className="page-subtitle">
                View and manage tenant registration information
              </Typography>
            </div>
            <Button
              variant="contained"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleting || (location.state?.sbtaws_active === false)}
              className="delete-tenant-button"
            >
              Delete Tenant
            </Button>
          </Box>

          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Tenant Registration Information
                  </Typography>
                  
                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary">
                      Tenant Name
                    </Typography>
                    <Typography variant="body1">
                      {location.state?.tenantName || 'N/A'}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary">
                      Registration ID
                    </Typography>
                    <Typography variant="body1">
                      {tenant.tenantRegistrationId || 'N/A'}
                    </Typography>
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary">
                      Registration Status
                    </Typography>
                    <Chip
                      label={tenant.registrationStatus?.toUpperCase() || 'UNKNOWN'}
                      color={getStatusColor(tenant.registrationStatus?.toLowerCase() || '') as any}
                      size="small"
                    />
                  </Box>

                  <Box className="tenant-detail-field">
                    <Typography variant="body2" color="text.secondary">
                      Tenant ID (from URL)
                    </Typography>
                    <Typography variant="body1">
                      {id}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </div>
      </div>
      
      <DeleteTenantDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        isDeleting={deleting}
      />
    </>
  );
};

export default TenantDetail;
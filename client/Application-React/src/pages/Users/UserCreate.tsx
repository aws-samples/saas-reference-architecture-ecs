import React, { useState } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  CardActions,
  TextField,
  Button,
  MenuItem,
  Alert,
  CircularProgress,
  InputAdornment,
  Snackbar,
} from '@mui/material';
import {
  Person as PersonIcon,
  Email as EmailIcon,
  VpnKey as VpnKeyIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { CreateUserRequest } from '../../types/User';
import { userService } from '../../services/userService';

const UserCreate: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  
  const [formData, setFormData] = useState<CreateUserRequest>({
    userName: '',
    userEmail: '',
    userRole: '',
  });

  const [formErrors, setFormErrors] = useState({
    userName: '',
    userEmail: '',
    userRole: '',
  });

  const userRoles = [
    { value: 'TenantAdmin', label: 'TenantAdmin' },
    { value: 'TenantUser', label: 'TenantUser' },
  ];

  const handleInputChange = (field: keyof CreateUserRequest) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    // Real-time validation for email field
    if (field === 'userEmail' && value.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        setFormErrors(prev => ({
          ...prev,
          userEmail: 'A valid email must be provided'
        }));
      } else {
        setFormErrors(prev => ({
          ...prev,
          userEmail: ''
        }));
      }
    } else {
      // Clear field error when user starts typing
      if (formErrors[field]) {
        setFormErrors(prev => ({
          ...prev,
          [field]: ''
        }));
      }
    }
  };

  const validateForm = (): boolean => {
    const errors = {
      userName: '',
      userEmail: '',
      userRole: '',
    };

    if (!formData.userName.trim()) {
      errors.userName = 'Username is required';
    }

    if (!formData.userEmail.trim()) {
      errors.userEmail = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.userEmail)) {
      errors.userEmail = 'A valid email must be provided';
    }

    if (!formData.userRole.trim()) {
      errors.userRole = 'User role is required';
    }

    setFormErrors(errors);
    return !errors.userName && !errors.userEmail && !errors.userRole;
  };

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      setIsLoading(true);
      setError('');

      await userService.create(formData);
      setSuccess(true);
      showSnackbar('Successfully created new user!');
      
      // Angular에서는 폼을 리셋하지 않고 성공 상태만 표시
      // 필요시 navigate('/users')로 목록으로 이동 가능
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'An unexpected error occurred!');
      showSnackbar('An unexpected error occurred!');
      console.error('Error creating user:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    navigate('/users');
  };

  const handleSnackbarClose = () => {
    setSnackbarOpen(false);
  };

  const isFormValid = formData.userName.trim() && 
                     formData.userEmail.trim() && 
                     formData.userRole.trim() && 
                     !formErrors.userName && 
                     !formErrors.userEmail && 
                     !formErrors.userRole;

  return (
    <Box>
      <div>
        <Typography variant="h4" className="page-title">
          Create User
        </Typography>
        <Typography variant="body2" className="page-subtitle">
          Add a new user account to the system
        </Typography>
      </div>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          User created successfully!
        </Alert>
      )}

      <Card className="modern-card" sx={{ maxWidth: 600 }}>
        <form onSubmit={handleSubmit}>
          <CardContent className="modern-card-content">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Upon submission, a new user account will be created and we will
              send an email to the provided address with login instructions.
            </Typography>

            <Box className="form-fields-container">
              <TextField
                label="Username"
                value={formData.userName}
                onChange={handleInputChange('userName')}
                error={!!formErrors.userName}
                helperText={formErrors.userName}
                required
                fullWidth
                variant="outlined"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <PersonIcon sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: 'rgba(0,0,0,0.02)',
                    '&:hover': {
                      backgroundColor: 'rgba(0,0,0,0.04)',
                    },
                    '&.Mui-focused': {
                      backgroundColor: 'white',
                      boxShadow: '0 0 0 3px rgba(25, 118, 210, 0.1)',
                    }
                  }
                }}
              />

              <TextField
                label="Email"
                type="email"
                value={formData.userEmail}
                onChange={handleInputChange('userEmail')}
                error={!!formErrors.userEmail}
                helperText={formErrors.userEmail}
                required
                fullWidth
                variant="outlined"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <EmailIcon sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: 'rgba(0,0,0,0.02)',
                    '&:hover': {
                      backgroundColor: 'rgba(0,0,0,0.04)',
                    },
                    '&.Mui-focused': {
                      backgroundColor: 'white',
                      boxShadow: '0 0 0 3px rgba(25, 118, 210, 0.1)',
                    }
                  }
                }}
              />

              <TextField
                select
                label="User Role"
                value={formData.userRole}
                onChange={handleInputChange('userRole')}
                error={!!formErrors.userRole}
                helperText={formErrors.userRole}
                required
                fullWidth
                variant="outlined"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <VpnKeyIcon sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: 'rgba(0,0,0,0.02)',
                    '&:hover': {
                      backgroundColor: 'rgba(0,0,0,0.04)',
                    },
                    '&.Mui-focused': {
                      backgroundColor: 'white',
                      boxShadow: '0 0 0 3px rgba(25, 118, 210, 0.1)',
                    }
                  }
                }}
              >
                {userRoles.map((role) => (
                  <MenuItem key={role.value} value={role.value}>
                    {role.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          </CardContent>

          <CardActions className="modern-button-container">
            <Button
              variant="outlined"
              color="secondary"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={!isFormValid || isLoading}
              startIcon={isLoading ? <CircularProgress size={20} /> : null}
            >
              {isLoading ? 'Creating...' : 'Submit'}
            </Button>
          </CardActions>
        </form>
      </Card>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        message={snackbarMessage}
        action={
          <Button color="inherit" size="small" onClick={handleSnackbarClose}>
            Dismiss
          </Button>
        }
      />
    </Box>
  );
};

export default UserCreate;
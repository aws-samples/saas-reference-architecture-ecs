import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Chip,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { User } from '../../types/User';
import { userService } from '../../services/userService';

const UserList: React.FC = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      setError('');
      const data = await userService.fetch();
      console.log('User data received:', data);
      if (data.length > 0) {
        console.log('First user object:', data[0]);
        console.log('Available keys:', Object.keys(data[0]));
      }
      setUsers(data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch users');
      console.error('Error fetching users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = () => {
    navigate('/users/create');
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status?: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (status?.toLowerCase()) {
      case 'confirmed':
        return 'success';
      case 'unconfirmed':
        return 'warning';
      case 'archived':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <div>
        <Typography variant="h4" className="page-title">
          Users
        </Typography>
        <Typography variant="body2" className="page-subtitle">
          Manage user accounts and permissions
        </Typography>
      </div>

      {error && (
        <Alert severity="error" className="error-alert">
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box className="loading-container">
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} className="unified-table-container">
          <Table>
            <TableHead className="unified-table-head">
              <TableRow>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Modified Date</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Enabled</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" className="unified-table-empty">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user, index) => (
                  <TableRow key={user.email || index} className="unified-table-row">
                    <TableCell className="unified-table-email">{user.email}</TableCell>
                    <TableCell>
                      {(user as any).user_role ? (
                        <Chip 
                          label={(user as any).user_role} 
                          size="small"
                          className="user-role-chip"
                        />
                      ) : (
                        <span className="unified-table-secondary">-</span>
                      )}
                    </TableCell>
                    <TableCell className="unified-table-secondary">{formatDate(user.modified)}</TableCell>
                    <TableCell>
                      {user.status ? (
                        <Chip 
                          label={user.status} 
                          color={getStatusColor(user.status)}
                          size="small"
                          className="user-chip"
                        />
                      ) : (
                        <span className="unified-table-secondary">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={user.enabled ? 'Yes' : 'No'} 
                        color={user.enabled ? 'success' : 'error'}
                        size="small"
                        className="user-chip"
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box sx={{ mt: 2 }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddUser}
        >
          Add User
        </Button>
      </Box>
    </Box>
  );
};

export default UserList;
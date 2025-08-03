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
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Order } from '../../types/Order';
import { orderService } from '../../services/orderService';

const OrderList: React.FC = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      setError('');
      const data = await orderService.fetch();
      setOrders(data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch orders');
      console.error('Error fetching orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOrderClick = (order: Order) => {
    // Angular와 동일한 형식: tenantId:orderId
    navigate(`/orders/${order.tenantId}:${order.orderId}`);
  };

  const handleCreateOrder = () => {
    navigate('/orders/create');
  };

  // Angular의 sum 함수와 동일
  const calculateTotal = (order: Order): number => {
    return order.orderProducts
      .map((p) => p.price * p.quantity)
      .reduce((acc, curr) => acc + curr, 0);
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <div>
        <Typography variant="h4" className="page-title">
          Orders
        </Typography>
        <Typography variant="body2" className="page-subtitle">
          Manage customer orders and track order status
        </Typography>
      </div>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer 
        component={Paper} 
        sx={{ 
          border: '1px solid #e0e0e0',
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}
      >
        <Table>
          <TableHead>
            <TableRow sx={{ 
              backgroundColor: '#f8f9fa',
              '& .MuiTableCell-head': {
                fontWeight: 600,
                color: '#2c3e50',
                borderBottom: '2px solid #dee2e6',
                fontSize: '0.95rem'
              }
            }}>
              <TableCell>Name</TableCell>
              <TableCell>Line Items</TableCell>
              <TableCell>Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 4, color: '#6c757d' }}>
                  No orders found
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow 
                  key={order.key || `${order.tenantId}:${order.orderId}`}
                  sx={{ 
                    '&:nth-of-type(even)': { backgroundColor: '#f8f9fa' },
                    '&:hover': { backgroundColor: '#e3f2fd' },
                    '& .MuiTableCell-root': {
                      borderBottom: '1px solid #dee2e6',
                      py: 1.5
                    }
                  }}
                >
                  <TableCell>
                    <Button
                      variant="text"
                      onClick={() => handleOrderClick(order)}
                      sx={{ 
                        textTransform: 'none', 
                        p: 0, 
                        minWidth: 'auto',
                        color: '#1976d2',
                        fontWeight: 500,
                        '&:hover': { backgroundColor: 'transparent', textDecoration: 'underline' }
                      }}
                    >
                      {order.orderName}
                    </Button>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{order.orderProducts?.length || 0}</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: '#2e7d32' }}>${calculateTotal(order).toFixed(2)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ mt: 2 }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateOrder}
        >
          Create Order
        </Button>
      </Box>
    </Box>
  );
};

export default OrderList;
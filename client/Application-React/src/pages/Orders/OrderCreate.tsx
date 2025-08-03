import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  CardActions,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Add as AddIcon, Remove as RemoveIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Product } from '../../types/Product';
import { LineItem, Order } from '../../types/Order';
import { productService } from '../../services/productService';
import { orderService } from '../../services/orderService';

const OrderCreate: React.FC = () => {
  const navigate = useNavigate();
  const [orderName, setOrderName] = useState('');
  const [orderProducts, setOrderProducts] = useState<LineItem[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setIsLoadingProducts(true);
      setError('');
      const products = await productService.fetch();
      // Angular와 동일: products를 LineItem으로 변환
      setOrderProducts(products.map((p) => ({ product: p })));
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch products');
      console.error('Error fetching products:', err);
    } finally {
      setIsLoadingProducts(false);
    }
  };

  // Angular의 add 함수와 동일
  const handleAdd = (lineItem: LineItem) => {
    setOrderProducts(prevItems =>
      prevItems.map(item => {
        if (item.product.productId === lineItem.product.productId) {
          return {
            ...item,
            quantity: item.quantity ? item.quantity + 1 : 1,
          };
        }
        return item;
      })
    );
  };

  // Angular의 remove 함수와 동일
  const handleRemove = (lineItem: LineItem) => {
    setOrderProducts(prevItems =>
      prevItems.map(item => {
        if (item.product.productId === lineItem.product.productId) {
          return {
            ...item,
            quantity: item.quantity && item.quantity > 1 ? item.quantity - 1 : undefined,
          };
        }
        return item;
      })
    );
  };

  // Angular의 productQuantity getter와 동일
  const hasProductQuantity = (): boolean => {
    return orderProducts.filter(p => !!p.quantity).length > 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!orderName.trim() || !hasProductQuantity()) {
      return;
    }

    try {
      setIsSaving(true);
      setError('');

      // Angular의 submit 함수와 동일한 데이터 구조
      const orderData: Omit<Order, 'key' | 'tenantId' | 'orderId'> = {
        orderName: orderName.trim(),
        orderProducts: orderProducts
          .filter(p => !!p.quantity)
          .map(p => ({
            productId: p.product.productId,
            price: p.product.price,
            quantity: p.quantity!,
          })),
      };

      await orderService.create(orderData);
      navigate('/orders');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to create order');
      console.error('Error creating order:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/orders');
  };

  const isFormValid = orderName.trim() && hasProductQuantity();

  if (isLoadingProducts) {
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
          Create Order
        </Typography>
        <Typography variant="body2" className="page-subtitle">
          Create a new order by selecting products and quantities
        </Typography>
      </div>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ 
        maxWidth: 800, 
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)', 
        borderRadius: 3,
        border: '1px solid rgba(0,0,0,0.06)'
      }}>
        <form onSubmit={handleSubmit}>
          <CardContent sx={{ p: 4 }}>
            <TextField
              label="Order Name"
              placeholder="Enter order name"
              value={orderName}
              onChange={(e) => setOrderName(e.target.value)}
              required
              fullWidth
              variant="outlined"
              sx={{ 
                mb: 4,
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

            <Typography variant="h6" gutterBottom>
              Products
            </Typography>

            <TableContainer component={Paper} sx={{ mb: 2 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Product Name</TableCell>
                    <TableCell>Price</TableCell>
                    <TableCell>Quantity</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {orderProducts.map((lineItem) => (
                    <TableRow key={lineItem.product.productId}>
                      <TableCell>{lineItem.product.name}</TableCell>
                      <TableCell>${lineItem.product.price.toFixed(2)}</TableCell>
                      <TableCell>{lineItem.quantity || 0}</TableCell>
                      <TableCell align="center">
                        <IconButton
                          onClick={() => handleAdd(lineItem)}
                          color="primary"
                          size="small"
                        >
                          <AddIcon />
                        </IconButton>
                        <IconButton
                          onClick={() => handleRemove(lineItem)}
                          color="error"
                          size="small"
                          disabled={!lineItem.quantity}
                        >
                          <RemoveIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>

          <CardActions sx={{ justifyContent: 'flex-end', gap: 1, p: 2 }}>
            <Button
              variant="outlined"
              color="secondary"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={!isFormValid || isSaving}
              startIcon={isSaving ? <CircularProgress size={20} /> : null}
            >
              {isSaving ? 'Creating...' : 'Submit'}
            </Button>
          </CardActions>
        </form>
      </Card>
    </Box>
  );
};

export default OrderCreate;
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
  IconButton,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Product } from '../../types/Product';
import { productService } from '../../services/productService';
import { handleApiError } from '../../types/errors';

const ProductList: React.FC = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      setError('');
      const data = await productService.fetch();
      setProducts(data);
    } catch (error: any) {
      setError(handleApiError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (product: Product) => {
    // Same format as Angular: tenantId:productId
    navigate(`/products/${product.tenantId}:${product.productId}/edit`);
  };



  const handleCreate = () => {
    navigate('/products/create');
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
          Products
        </Typography>
        <Typography variant="body2" className="page-subtitle">
          Manage your product catalog and inventory
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
              <TableCell>Price</TableCell>
              <TableCell>SKU</TableCell>
              <TableCell>Category</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: '#6c757d' }}>
                  No products found
                </TableCell>
              </TableRow>
            ) : (
              products.map((product, index) => (
                <TableRow 
                  key={product.key || `${product.tenantId}:${product.productId}`}
                  sx={{ 
                    '&:nth-of-type(even)': { backgroundColor: '#f8f9fa' },
                    '&:hover': { backgroundColor: '#e3f2fd' },
                    '& .MuiTableCell-root': {
                      borderBottom: '1px solid #dee2e6',
                      py: 1
                    }
                  }}
                >
                  <TableCell>
                    <Button
                      variant="text"
                      onClick={() => handleEdit(product)}
                      sx={{ 
                        textTransform: 'none', 
                        p: 0, 
                        minWidth: 'auto',
                        color: '#1976d2',
                        fontWeight: 500,
                        '&:hover': { backgroundColor: 'transparent', textDecoration: 'underline' }
                      }}
                    >
                      {product.name}
                    </Button>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>${product.price.toFixed(2)}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{product.sku}</TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      onClick={() => handleEdit(product)}
                      color="primary"
                      size="small"
                      sx={{ 
                        '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.1)' }
                      }}
                    >
                      <EditIcon />
                    </IconButton>
                  </TableCell>
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
          onClick={handleCreate}
        >
          Create Product
        </Button>
      </Box>
    </Box>
  );
};

export default ProductList;
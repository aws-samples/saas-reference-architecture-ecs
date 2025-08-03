import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { Product } from '../../types/Product';
import { productService } from '../../services/productService';

const ProductEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [product, setProduct] = useState<Product | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    sku: '',
    category: '',
  });

  const [formErrors, setFormErrors] = useState({
    name: '',
    price: '',
  });

  const categories = ['category1', 'category2', 'category3', 'category4'];

  useEffect(() => {
    if (id) {
      fetchProduct(id);
    }
  }, [id]);

  const fetchProduct = async (productId: string) => {
    try {
      setIsLoading(true);
      setError('');
      console.log('Fetching product with ID:', productId); // 디버깅용
      const productData = await productService.get(productId);
      setProduct(productData);
      setFormData({
        name: productData.name,
        price: productData.price.toString(),
        sku: productData.sku,
        category: productData.category,
      });
    } catch (err: any) {
      console.error('Error fetching product:', err);
      console.error('Product ID used:', productId); // 디버깅용
      setError(err.response?.data?.message || err.message || 'Failed to fetch product');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    // Clear field error when user starts typing
    if (formErrors[field as keyof typeof formErrors]) {
      setFormErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const validateForm = (): boolean => {
    const errors = {
      name: '',
      price: '',
    };

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }

    if (!formData.price.trim()) {
      errors.price = 'Price is required';
    } else if (isNaN(Number(formData.price)) || Number(formData.price) <= 0) {
      errors.price = 'Price must be a valid positive number';
    }

    setFormErrors(errors);
    return !errors.name && !errors.price;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!validateForm() || !product) {
      return;
    }

    try {
      setIsSaving(true);
      setError('');

      const updatedProduct: Product = {
        ...product,
        name: formData.name.trim(),
        price: Number(formData.price),
        sku: formData.sku.trim(),
        category: formData.category,
      };

      await productService.put(updatedProduct);
      navigate('/products');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to update product');
      console.error('Error updating product:', err);
    } finally {
      setIsSaving(false);
    }
  };



  const handleCancel = () => {
    navigate('/products');
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  if (!product) {
    return (
      <Box>
        <Alert severity="error">
          Product not found
        </Alert>
      </Box>
    );
  }

  const isFormValid = formData.name.trim() && formData.price.trim() && !formErrors.name && !formErrors.price;

  return (
    <Box>
      <div>
        <Typography variant="h4" className="page-title">
          Edit Product
        </Typography>
        <Typography variant="body2" className="page-subtitle">
          Update product information: {product.name}
        </Typography>
      </div>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ maxWidth: 600 }}>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Enter product name"
                placeholder="Product name"
                value={formData.name}
                onChange={handleInputChange('name')}
                error={!!formErrors.name}
                helperText={formErrors.name}
                required
                fullWidth
              />

              <TextField
                label="Enter product price"
                placeholder="Product price"
                type="number"
                value={formData.price}
                onChange={handleInputChange('price')}
                error={!!formErrors.price}
                helperText={formErrors.price}
                required
                fullWidth
                inputProps={{ min: 0, step: 0.01 }}
              />

              <TextField
                label="SKU"
                placeholder="Enter product sku"
                value={formData.sku}
                onChange={handleInputChange('sku')}
                fullWidth
              />

              <TextField
                select
                label="Category"
                value={formData.category}
                onChange={handleInputChange('category')}
                fullWidth
              >
                {categories.map((category) => (
                  <MenuItem key={category} value={category}>
                    {category}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
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
              {isSaving ? 'Saving...' : 'Submit'}
            </Button>
          </CardActions>
        </form>
      </Card>
    </Box>
  );
};

export default ProductEdit;
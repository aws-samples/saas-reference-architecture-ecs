import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { CircularProgress, Box, Typography } from "@mui/material";
import { withAuthenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import Layout from "./components/Layout/Layout";
import Dashboard from "./pages/Dashboard/Dashboard";
import ProductList from "./pages/Products/ProductList";
import ProductCreate from "./pages/Products/ProductCreate";
import ProductEdit from "./pages/Products/ProductEdit";
import OrderList from "./pages/Orders/OrderList";
import OrderCreate from "./pages/Orders/OrderCreate";
import OrderDetail from "./pages/Orders/OrderDetail";
import UserList from "./pages/Users/UserList";
import UserCreate from "./pages/Users/UserCreate";
import AuthInfo from "./pages/Auth/AuthInfo";
import UnauthorizedPage from "./pages/Error/UnauthorizedPage";
import { useTenant } from "./contexts/TenantContext";
import { authConfigService } from "./services/authConfigService";
import "@aws-amplify/ui-react/styles.css";

// Main app component (for authenticated users)
const AuthenticatedApp: React.FC = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/products" element={<ProductList />} />
        <Route path="/products/create" element={<ProductCreate />} />
        <Route path="/products/:id/edit" element={<ProductEdit />} />

        <Route path="/orders" element={<OrderList />} />
        <Route path="/orders/create" element={<OrderCreate />} />
        <Route path="/orders/:id" element={<OrderDetail />} />

        <Route path="/users" element={<UserList />} />
        <Route path="/users/create" element={<UserCreate />} />

        <Route path="/auth/info" element={<AuthInfo />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
      </Routes>
    </Layout>
  );
};

// Authenticated app wrapped with withAuthenticator
const AuthenticatedAppWithAuth = withAuthenticator(AuthenticatedApp, {
  hideSignUp: true,
});

function App() {
  const { tenant, loading: tenantLoading } = useTenant();
  const [amplifyConfigured, setAmplifyConfigured] = useState(false);

  // Amplify configuration (equivalent to Angular's configureAmplifyAuth)
  useEffect(() => {
    const configureAmplify = () => {
      const userPoolId = authConfigService.getUserPoolId();
      const appClientId = authConfigService.getAppClientId();

      if (userPoolId && appClientId) {
        const region = userPoolId.split("_")[0];
        const awsmobile = {
          aws_project_region: region,
          aws_cognito_region: region,
          aws_user_pools_id: userPoolId,
          aws_user_pools_web_client_id: appClientId,
          Storage: {
            AWSS3: {
              bucket: '',
              region: region
            }
          },
          // Force Amplify to use sessionStorage instead of localStorage
          Auth: {
            storage: sessionStorage
          }
        };

        console.log("Configuring Amplify with:", awsmobile);
        
        // Clear any existing Amplify/Cognito localStorage data to prevent conflicts
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('CognitoIdentityServiceProvider.') || 
              key.startsWith('amplify-') ||
              key.includes('aws-amplify')) {
            localStorage.removeItem(key);
          }
        });
        
        Amplify.configure(awsmobile);
        setAmplifyConfigured(true);
      } else {
        setAmplifyConfigured(false);
      }
    };

    configureAmplify();
  }, [tenant, tenantLoading]); // Reconfigure when tenant changes

  // While tenant is loading
  if (tenantLoading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        gap={2}
      >
        <CircularProgress size={60} />
        <Typography variant="h6" color="text.secondary">
          Loading tenant configuration...
        </Typography>
      </Box>
    );
  }

  // If tenant is not configured or sessionStorage has no Cognito info
  const hasUserPoolConfig = sessionStorage.getItem('app_userPoolId') && sessionStorage.getItem('app_appClientId');
  
  if (!tenant || !amplifyConfigured || !hasUserPoolConfig) {
    return <UnauthorizedPage />;
  }

  // Show withAuthenticator app only when tenant and Amplify are configured
  return <AuthenticatedAppWithAuth />;
}

export default App;

import React, { useMemo, useCallback } from "react";
import {
  Box,
  CssBaseline,
  Drawer,
  Toolbar,
} from "@mui/material";
import {
  DashboardOutlined as DashboardIcon,
  Inventory2Outlined as ProductsIcon,
  ShoppingCartOutlined as OrdersIcon,
  PeopleOutlined as UsersIcon,
  BugReportOutlined as DebugIcon,
  SwapHorizOutlined as SwapIcon,
} from "@mui/icons-material";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useTenant } from "../../contexts/TenantContext";
import { useLayout } from './hooks/useLayout';
import { DRAWER_WIDTH } from './constants';
import { LayoutProps, MenuItem } from './types';
import DrawerContent from './components/DrawerContent';
import AppHeader from './components/AppHeader';

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuthenticator();
  const { setTenant } = useTenant();
  const { mobileOpen, desktopOpen, handleDrawerToggle, handleMobileDrawerToggle } = useLayout();

  const mainMenuItems: MenuItem[] = useMemo(() => [
    { text: "Dashboard", icon: <DashboardIcon />, path: "/dashboard" },
    { text: "Products", icon: <ProductsIcon />, path: "/products" },
    { text: "Orders", icon: <OrdersIcon />, path: "/orders" },
    { text: "Users", icon: <UsersIcon />, path: "/users" },
  ], []);

  const handleChangeTenant = useCallback(() => {
    setTenant(null);
  }, [setTenant]);

  const handleLogout = useCallback(async () => {
    try {
      // Clear tenant context first
      setTenant(null);
      
      // Clear all sessionStorage
      sessionStorage.clear();
      
      // Sign out from Amplify
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
      // Even if signOut fails, clear local data
      sessionStorage.clear();
      setTenant(null);
    }
  }, [signOut, setTenant]);

  const bottomMenuItems: MenuItem[] = useMemo(() => [
    { text: "Auth Debug", icon: <DebugIcon />, path: "/auth/info" },
    { text: "Tenant Change", icon: <SwapIcon />, action: handleChangeTenant },
  ], [handleChangeTenant]);

  const userEmail = String(
    user?.attributes?.email ||
    user?.username ||
    "User"
  );

  const drawerContent = (
    <DrawerContent
      mainItems={mainMenuItems}
      bottomItems={bottomMenuItems}
      currentPath={location.pathname}
      onNavigate={navigate}
      onAction={(action) => action()}
    />
  );

  return (
    <Box sx={{ display: "flex" }}>
      <CssBaseline />
      <AppHeader
        desktopOpen={desktopOpen}
        userEmail={userEmail}
        onDrawerToggle={handleDrawerToggle}
        onMobileDrawerToggle={handleMobileDrawerToggle}
        onLogout={handleLogout}
      />
      <Box
        component="nav"
        sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleMobileDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: "block", sm: "none" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
            },
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="persistent"
          sx={{
            display: { xs: "none", sm: "block" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
            },
          }}
          open={desktopOpen}
        >
          {drawerContent}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: desktopOpen ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%' },
          transition: 'width 0.3s'
        }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
};

export default Layout;

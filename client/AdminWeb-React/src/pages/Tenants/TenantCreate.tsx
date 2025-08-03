import React, { useState } from "react";
import {
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  Grid,
  FormControlLabel,
  Switch,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import BusinessIcon from "@mui/icons-material/Business";
import PeopleIcon from "@mui/icons-material/People";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import EmailIcon from "@mui/icons-material/Email";
import { CreateTenantRequest } from "../../models/tenant";
import tenantService from "../../services/tenantService";
import { useAuth } from "../../contexts/AuthContext";
// CSS 직접 import
import "../../styles/index.css";

interface FormData {
  tenantName: string;
  email: string;
  tier: string;
  useFederation: boolean;
}

const TenantCreate: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    tenantName: "",
    email: "",
    tier: "ADVANCED",
    useFederation: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState<{
    [key: string]: string;
  }>({});
  const navigate = useNavigate();
  const { user } = useAuth();

  const validateTenantName = (name: string): string | null => {
    if (!name) return "Tenant name is required";
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      return "Must start with a lowercase letter, and only contain lowercase letters, numbers, and hyphens";
    }
    return null;
  };

  const validateEmail = (email: string): string | null => {
    if (!email) return "Email is required";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return "Please enter a valid email address";
    return null;
  };

  const handleEmailBlur = () => {
    const emailError = validateEmail(formData.email);
    if (emailError) {
      setValidationErrors((prev) => ({
        ...prev,
        email: emailError,
      }));
    } else {
      setValidationErrors((prev) => ({
        ...prev,
        email: "",
      }));
    }
  };

  const handleChange = (field: keyof FormData) => (event: any) => {
    const value =
      field === "useFederation" ? event.target.checked : event.target.value;

    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear validation error when user starts typing
    if (validationErrors[field]) {
      setValidationErrors((prev) => ({
        ...prev,
        [field]: "",
      }));
    }

    // Handle federation control based on tier
    if (field === "tier") {
      if (value !== "ADVANCED" && value !== "PREMIUM") {
        setFormData((prev) => ({
          ...prev,
          useFederation: false,
        }));
      }
    }
  };

  const validateForm = (): boolean => {
    const errors: { [key: string]: string } = {};

    const tenantNameError = validateTenantName(formData.tenantName);
    if (tenantNameError) errors.tenantName = tenantNameError;

    const emailError = validateEmail(formData.email);
    if (emailError) errors.email = emailError;

    if (!formData.tier) errors.tier = "Tier is required";

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 인증 체크 추가
    if (!user || !user.access_token) {
      setError("Authentication required. Please log in again.");
      return;
    }

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const tenant: CreateTenantRequest = {
        tenantId: uuid(),
        tenantData: {
          tenantName: formData.tenantName,
          email: formData.email,
          tier: formData.tier,
          prices: [],
          useFederation: String(formData.useFederation),
        },
        tenantRegistrationData: {
          registrationStatus: "In progress",
        },
      };

      await tenantService.createTenant(tenant);
      navigate("/tenants");
    } catch (err: any) {
      if (err.response?.status === 401) {
        setError("Authentication expired. Please log in again.");
      } else {
        setError("Failed to create tenant. Please try again.");
      }
      console.error("Error creating tenant:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tenant-create-container">
      <div className="tenant-create-content">
        {/* Header with Back Button */}
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/tenants")}
          className="tenant-back-button"
        >
          Back to Tenants
        </Button>

        <Grid container spacing={3}>
          {/* Main Form */}
          <Grid item xs={12} lg={9}>
            <Card className="tenant-glass-card">
              <CardContent className="tenant-main-card">
                <div className="page-header">
                  <AddIcon className="tenant-page-icon" />
                  <Typography variant="h4" className="page-title">
                    Onboard New Tenant
                  </Typography>
                </div>
                <Typography variant="body2" className="page-subtitle">
                  Set up a new tenant organization with automated infrastructure
                  provisioning
                </Typography>

                {error && (
                  <Alert severity="error" className="custom-alert">
                    {error}
                  </Alert>
                )}

                <form onSubmit={handleSubmit}>
                  {/* Company Name */}
                  <div className="form-section">
                    <label className="form-label">
                      Company Name <span className="required-asterisk">*</span>
                    </label>
                    <TextField
                      fullWidth
                      placeholder="Enter company name"
                      value={formData.tenantName}
                      onChange={handleChange("tenantName")}
                      error={!!validationErrors.tenantName}
                      helperText={validationErrors.tenantName}
                      required
                      className="custom-input"
                    />
                  </div>

                  {/* Institution Name - 당분간 사용하지 않음 */}
                  {/* <div className="form-section">
                    <label className="form-label">
                      Institution Name{" "}
                      <span className="required-asterisk">*</span>
                    </label>
                    <TextField
                      fullWidth
                      placeholder="Enter institution name"
                      value={formData.tenantName}
                      onChange={handleChange("tenantName")}
                      error={!!validationErrors.tenantName}
                      helperText={validationErrors.tenantName}
                      required
                      className="custom-input"
                    />
                  </div> */}

                  {/* Administrator Email */}
                  <div className="form-section">
                    <label className="form-label">
                      Administrator Email{" "}
                      <span className="required-asterisk">*</span>
                    </label>
                    <TextField
                      fullWidth
                      type="email"
                      placeholder="admin@company.com"
                      value={formData.email}
                      onChange={handleChange("email")}
                      onBlur={handleEmailBlur}
                      error={!!validationErrors.email}
                      helperText={validationErrors.email}
                      required
                      className="custom-input"
                    />
                  </div>

                  {/* Tier Selection */}
                  <div className="form-section">
                    <label className="form-label">
                      Tier <span className="required-asterisk">*</span>
                    </label>

                    <Grid container spacing={2}>
                      <Grid item xs={12} md={4}>
                        <Card
                          className={`tenant-plan-card ${
                            formData.tier === "BASIC" ? "selected" : ""
                          }`}
                          onClick={() =>
                            handleChange("tier")({ target: { value: "BASIC" } })
                          }
                        >
                          <div className="plan-header">
                            <Typography variant="h6" className="plan-title">
                              Basic
                            </Typography>
                            <Typography variant="body2" className="plan-price">
                              $29/month
                            </Typography>
                          </div>
                          <Typography
                            variant="body2"
                            className="plan-description"
                          >
                            Perfect for small teams
                          </Typography>
                        </Card>
                      </Grid>

                      <Grid item xs={12} md={4}>
                        <Card
                          className={`tenant-plan-card ${
                            formData.tier === "ADVANCED" ? "selected" : ""
                          }`}
                          onClick={() =>
                            handleChange("tier")({
                              target: { value: "ADVANCED" },
                            })
                          }
                        >
                          <div className="plan-header">
                            <Typography variant="h6" className="plan-title">
                              Advanced
                            </Typography>
                            <Typography variant="body2" className="plan-price">
                              $99/month
                            </Typography>
                          </div>
                          <Typography
                            variant="body2"
                            className="plan-description"
                          >
                            Ideal for growing businesses
                          </Typography>
                        </Card>
                      </Grid>

                      <Grid item xs={12} md={4}>
                        <Card
                          className={`tenant-plan-card ${
                            formData.tier === "PREMIUM" ? "selected" : ""
                          }`}
                          onClick={() =>
                            handleChange("tier")({
                              target: { value: "PREMIUM" },
                            })
                          }
                        >
                          <div className="plan-header">
                            <Typography variant="h6" className="plan-title">
                              Premium
                            </Typography>
                            <Typography variant="body2" className="plan-price">
                              $299/month
                            </Typography>
                          </div>
                          <Typography
                            variant="body2"
                            className="plan-description"
                          >
                            For large organizations
                          </Typography>
                        </Card>
                      </Grid>
                    </Grid>

                    {validationErrors.tier && (
                      <Typography
                        variant="caption"
                        color="error"
                        className="tenant-validation-error"
                      >
                        {validationErrors.tier}
                      </Typography>
                    )}
                  </div>

                  {/* Federation Switch */}
                  <div className="federation-section">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={formData.useFederation}
                          onChange={handleChange("useFederation")}
                          disabled={
                            formData.tier !== "ADVANCED" &&
                            formData.tier !== "PREMIUM"
                          }
                        />
                      }
                      label="Use Federation"
                    />
                    {formData.tier !== "ADVANCED" &&
                      formData.tier !== "PREMIUM" && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          className="federation-help-text"
                        >
                          Federation is only available for Advanced and Premium
                          tiers
                        </Typography>
                      )}
                  </div>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    fullWidth
                    disabled={loading}
                    className="tenant-submit-button"
                  >
                    <AddIcon className="tenant-submit-icon" />
                    {loading ? "Creating Tenant..." : "Create Tenant"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} lg={3}>
            <Card className="tenant-glass-card">
              <CardContent className="tenant-sidebar-card">
                <div className="page-header">
                  <BusinessIcon className="tenant-sidebar-icon" />
                  <Typography variant="h5" className="page-title">
                    Tenant Preview
                  </Typography>
                </div>
                <Typography variant="body2" className="page-subtitle">
                  Review the tenant information to be created
                </Typography>

                <div>
                  <div className="feature-item">
                    <PeopleIcon className="feature-icon" />
                    <Typography variant="body2" className="feature-text">
                      User Management
                    </Typography>
                  </div>
                  <div className="feature-item">
                    <FlashOnIcon className="feature-icon" />
                    <Typography variant="body2" className="feature-text">
                      Auto Provisioning
                    </Typography>
                  </div>
                  <div className="feature-item">
                    <EmailIcon className="feature-icon" />
                    <Typography variant="body2" className="feature-text">
                      Administrator Invitation
                    </Typography>
                  </div>
                </div>

                <div className="sidebar-divider">
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    className="tenant-sidebar-caption"
                  >
                    The following resources will be automatically provisioned
                    after tenant creation:
                  </Typography>
                  <ul className="provision-list">
                    <li className="provision-item">DynamoDB Tables</li>
                    <li className="provision-item">Cognito User Pool</li>
                    <li className="provision-item">Tenant Service Setting</li>
                    <li className="provision-item">
                      Tenant Routing Configuration
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </div>
    </div>
  );
};

export default TenantCreate;

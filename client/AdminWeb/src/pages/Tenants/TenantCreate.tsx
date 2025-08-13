import React, { useState, useCallback } from "react";
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
import { handleApiError } from "../../types/errors";
import { PRICING_PLANS } from "../../constants/pricing";
import { TENANT_DEFAULTS } from "../../constants/tenant";
import "../../styles/index.css";

interface FormData {
  tenantName: string;
  email: string;
  tier: string;
  useFederation: boolean;
  useEc2: boolean;
  useRProxy: boolean;
}

const TenantCreate: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    tenantName: "",
    email: "",
    tier: "ADVANCED",
    useFederation: false,
    useEc2: false,
    useRProxy: true,
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

  const handleChange = useCallback(
    (field: keyof FormData) =>
      (
        event:
          | React.ChangeEvent<HTMLInputElement>
          | { target: { value: string; checked?: boolean } }
      ) => {
        const value =
          field === "useFederation" ||
          field === "useEc2" ||
          field === "useRProxy"
            ? event.target.checked
            : event.target.value;

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

        // Handle federation and EC2 control based on tier
        if (field === "tier") {
          if (value !== "ADVANCED" && value !== "PREMIUM") {
            setFormData((prev) => ({
              ...prev,
              useFederation: false,
            }));
          }
          if (value !== "PREMIUM") {
            setFormData((prev) => ({
              ...prev,
              useEc2: false,
            }));
          }
        }
      },
    [validationErrors]
  );

  const validateForm = useCallback((): boolean => {
    const errors: { [key: string]: string } = {};

    const tenantNameError = validateTenantName(formData.tenantName);
    if (tenantNameError) errors.tenantName = tenantNameError;

    const emailError = validateEmail(formData.email);
    if (emailError) errors.email = emailError;

    if (!formData.tier) errors.tier = "Tier is required";

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData.tenantName, formData.email, formData.tier]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Add authentication check
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
          useEc2: String(formData.useEc2),
          useRProxy: String(formData.useRProxy),
        },
        tenantRegistrationData: {
          registrationStatus: TENANT_DEFAULTS.REGISTRATION_STATUS,
        },
      };

      await tenantService.createTenant(tenant);
      navigate("/tenants");
    } catch (error: any) {
      setError(handleApiError(error));
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
          onClick={useCallback(() => navigate("/tenants"), [navigate])}
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
                  {/* Tenant Name */}
                  <div className="form-section">
                    <label className="form-label">
                      Tenant Name <span className="required-asterisk">*</span>
                    </label>
                    <TextField
                      fullWidth
                      placeholder="Enter tenant name"
                      value={formData.tenantName}
                      onChange={handleChange("tenantName")}
                      error={!!validationErrors.tenantName}
                      helperText={validationErrors.tenantName}
                      required
                      className="custom-input"
                    />
                  </div>

                  {/* Institution Name - Not used for now */}
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
                      {Object.values(PRICING_PLANS).map((plan) => (
                        <Grid item xs={12} md={4} key={plan.id}>
                          <Card
                            className={`tenant-plan-card ${
                              formData.tier === plan.id ? "selected" : ""
                            }`}
                            onClick={() =>
                              handleChange("tier")({
                                target: { value: plan.id },
                              })
                            }
                          >
                            <div className="plan-header">
                              <Typography variant="h6" className="plan-title">
                                {plan.name}
                              </Typography>
                              <Typography
                                variant="body2"
                                className="plan-price"
                              >
                                ${plan.price}/month
                              </Typography>
                            </div>
                            <Typography
                              variant="body2"
                              className="plan-description"
                            >
                              {plan.description}
                            </Typography>
                          </Card>
                        </Grid>
                      ))}
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

                  {/* Configuration Options */}
                  <div className="form-section">
                    <label className="form-label">Configuration Options</label>

                    <div className="config-switches-row">
                      <div className="config-switch-item">
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
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          className="config-description"
                        >
                          {formData.tier !== "ADVANCED" &&
                          formData.tier !== "PREMIUM"
                            ? "Advanced/Premium only"
                            : "Enable SSO integration"}
                        </Typography>
                      </div>

                      <div className="config-switch-item">
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData.useRProxy}
                              onChange={handleChange("useRProxy")}
                              disabled={formData.tier === "BASIC"}
                            />
                          }
                          label="Use Reverse Proxy"
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          className="config-description"
                        >
                          Enable request routing proxy
                        </Typography>
                      </div>

                      <div className="config-switch-item">
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData.useEc2}
                              onChange={handleChange("useEc2")}
                              disabled={formData.tier !== "PREMIUM"}
                            />
                          }
                          label="Use EC2"
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          className="config-description"
                        >
                          Use EC2 instead of Fargate
                        </Typography>
                      </div>
                    </div>
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

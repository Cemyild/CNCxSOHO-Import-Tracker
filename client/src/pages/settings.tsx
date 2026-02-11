import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator,
  Users, 
  FileText, 
  Plus, 
  MoreHorizontal, 
  Edit, 
  Trash2,
  Eye,
  EyeOff,
  Upload,
  Key,
  Package,
  Hash
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { UploadTemplateForm } from "@/components/ui/upload-template-form";
import { PageHeaderSkeleton } from "@/components/ui/branded-skeleton-loader";
import { PageLayout } from "@/components/layout/PageLayout";

interface User {
  id: number;
  username: string;
  email?: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLogin?: string;
}

interface HsCode {
  tr_hs_code: string;
  ex_registry_form: boolean;
  azo_dye_test: boolean;
  special_custom: boolean;
  customs_tax_percent: string | null;
  additional_customs_tax_percent: string | null;
  kkdf_percent: string | null;
  vat_percent: string | null;
  description_tr: string | null;
  unit: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Product {
  id: number;
  style: string | null;
  hts_code: string | null;
  tr_hs_code: string | null;
  item_description: string | null;
  brand: string | null;
  category: string | null;
  color: string | null;
  fabric_content: string | null;
  country_of_origin: string | null;
  createdAt: string;
  updatedAt: string;
}

// Menu items for navigation
const items = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Procedures",
    url: "/procedures",
    icon: Inbox,
  },
  {
    title: "Expenses",
    url: "/expenses",
    icon: Calendar,
  },
  {
    title: "Payments",
    url: "/payments",
    icon: Search,
  },
  {
    title: "Tax Calculation",
    url: "/tax-calculation",
    icon: Calculator,
  },
  {
    title: "Reports",
    url: "/reports",
    icon: BarChart2,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function SettingsPage() {
  const [showCreateUserDialog, setShowCreateUserDialog] = useState(false);
  const [showEditUserDialog, setShowEditUserDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newUserData, setNewUserData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user' as 'admin' | 'user'
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  
  // HS Codes state
  const [showHsCodeDialog, setShowHsCodeDialog] = useState(false);
  const [editingHsCode, setEditingHsCode] = useState<HsCode | null>(null);
  const [hsCodeFormData, setHsCodeFormData] = useState({
    tr_hs_code: '',
    ex_registry_form: false,
    azo_dye_test: false,
    special_custom: false,
    customs_tax_percent: '',
    additional_customs_tax_percent: '',
    kkdf_percent: '',
    vat_percent: '',
    description_tr: '',
    unit: ''
  });

  // Products state
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productFormData, setProductFormData] = useState({
    style: '',
    hts_code: '',
    tr_hs_code: '',
    item_description: ''
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current user info
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/auth/me');
      const userData = await response.json();
      console.log('Current user data:', userData);
      return userData;
    },
  });

  // Get all users (admin only)
  const { data: usersData, isLoading: isUsersLoading } = useQuery({
    queryKey: ['/api/users'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/users');
      return await response.json();
    },
    enabled: currentUser?.role === 'admin',
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (userData: typeof newUserData) => {
      const response = await apiRequest('POST', '/api/users', userData);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'User created successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setShowCreateUserDialog(false);
      setNewUserData({ username: '', email: '', password: '', role: 'user' });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to create user: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, userData }: { id: number; userData: Partial<User> }) => {
      const response = await apiRequest('PUT', `/api/users/${id}`, userData);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'User updated successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setShowEditUserDialog(false);
      setSelectedUser(null);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to update user: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/users/${id}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'User deleted successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (passwordInfo: typeof passwordData) => {
      const response = await apiRequest('POST', '/api/auth/change-password', passwordInfo);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Password changed successfully',
      });
      setShowPasswordDialog(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to change password: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    },
  });

  // ==========================================
  // HS CODES QUERIES AND MUTATIONS
  // ==========================================
  
  const { data: hsCodesData, isLoading: isHsCodesLoading } = useQuery({
    queryKey: ['/api/hs-codes'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/hs-codes');
      return await response.json();
    },
  });

  const createHsCodeMutation = useMutation({
    mutationFn: async (data: typeof hsCodeFormData) => {
      const response = await apiRequest('POST', '/api/hs-codes', {
        ...data,
        customs_tax_percent: data.customs_tax_percent || null,
        additional_customs_tax_percent: data.additional_customs_tax_percent || null,
        kkdf_percent: data.kkdf_percent || null,
        vat_percent: data.vat_percent || null,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'HS Code created successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/hs-codes'] });
      resetHsCodeForm();
    },
    onError: (error) => {
      toast({ title: 'Error', description: `Failed to create HS Code: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    },
  });

  const updateHsCodeMutation = useMutation({
    mutationFn: async ({ trHsCode, data }: { trHsCode: string; data: typeof hsCodeFormData }) => {
      const response = await apiRequest('PUT', `/api/hs-codes/${encodeURIComponent(trHsCode)}`, {
        ...data,
        customs_tax_percent: data.customs_tax_percent || null,
        additional_customs_tax_percent: data.additional_customs_tax_percent || null,
        kkdf_percent: data.kkdf_percent || null,
        vat_percent: data.vat_percent || null,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'HS Code updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/hs-codes'] });
      resetHsCodeForm();
    },
    onError: (error) => {
      toast({ title: 'Error', description: `Failed to update HS Code: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    },
  });

  const deleteHsCodeMutation = useMutation({
    mutationFn: async (trHsCode: string) => {
      const response = await apiRequest('DELETE', `/api/hs-codes/${encodeURIComponent(trHsCode)}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'HS Code deleted successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/hs-codes'] });
    },
    onError: (error) => {
      toast({ title: 'Error', description: `Failed to delete HS Code: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    },
  });

  // ==========================================
  // PRODUCTS QUERIES AND MUTATIONS
  // ==========================================

  const { data: productsData, isLoading: isProductsLoading } = useQuery({
    queryKey: ['/api/products'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/products');
      return await response.json();
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: typeof productFormData) => {
      const response = await apiRequest('POST', '/api/products', data);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Product created successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      resetProductForm();
    },
    onError: (error) => {
      toast({ title: 'Error', description: `Failed to create product: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof productFormData }) => {
      const response = await apiRequest('PUT', `/api/products/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Product updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      resetProductForm();
    },
    onError: (error) => {
      toast({ title: 'Error', description: `Failed to update product: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/products/${id}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Product deleted successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
    },
    onError: (error) => {
      toast({ title: 'Error', description: `Failed to delete product: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
    },
  });

  // Helper functions for HS Codes
  const resetHsCodeForm = () => {
    setShowHsCodeDialog(false);
    setEditingHsCode(null);
    setHsCodeFormData({
      tr_hs_code: '', ex_registry_form: false, azo_dye_test: false, special_custom: false,
      customs_tax_percent: '', additional_customs_tax_percent: '', kkdf_percent: '', vat_percent: '',
      description_tr: '', unit: ''
    });
  };

  const handleEditHsCode = (hsCode: HsCode) => {
    setEditingHsCode(hsCode);
    setHsCodeFormData({
      tr_hs_code: hsCode.tr_hs_code,
      ex_registry_form: hsCode.ex_registry_form,
      azo_dye_test: hsCode.azo_dye_test,
      special_custom: hsCode.special_custom,
      customs_tax_percent: hsCode.customs_tax_percent || '',
      additional_customs_tax_percent: hsCode.additional_customs_tax_percent || '',
      kkdf_percent: hsCode.kkdf_percent || '',
      vat_percent: hsCode.vat_percent || '',
      description_tr: hsCode.description_tr || '',
      unit: hsCode.unit || ''
    });
    setShowHsCodeDialog(true);
  };

  const handleSaveHsCode = () => {
    if (!hsCodeFormData.tr_hs_code) {
      toast({ title: 'Error', description: 'TR HS Code is required', variant: 'destructive' });
      return;
    }
    if (editingHsCode) {
      updateHsCodeMutation.mutate({ trHsCode: editingHsCode.tr_hs_code, data: hsCodeFormData });
    } else {
      createHsCodeMutation.mutate(hsCodeFormData);
    }
  };

  // Helper functions for Products
  const resetProductForm = () => {
    setShowProductDialog(false);
    setEditingProduct(null);
    setProductFormData({ style: '', hts_code: '', tr_hs_code: '', item_description: '' });
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProductFormData({
      style: product.style || '',
      hts_code: product.hts_code || '',
      tr_hs_code: product.tr_hs_code || '',
      item_description: product.item_description || ''
    });
    setShowProductDialog(true);
  };

  const handleSaveProduct = () => {
    if (!productFormData.style) {
      toast({ title: 'Error', description: 'Style is required', variant: 'destructive' });
      return;
    }
    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data: productFormData });
    } else {
      createProductMutation.mutate(productFormData);
    }
  };

  const handleCreateUser = () => {
    if (!newUserData.username || !newUserData.password) {
      toast({
        title: 'Error',
        description: 'Username and password are required',
        variant: 'destructive',
      });
      return;
    }
    createUserMutation.mutate(newUserData);
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setShowEditUserDialog(true);
  };

  const handleUpdateUser = () => {
    if (!selectedUser) return;
    updateUserMutation.mutate({
      id: selectedUser.id,
      userData: selectedUser
    });
  };

  const handleDeleteUser = (userId: number) => {
    if (userId === currentUser?.id) {
      toast({
        title: 'Error',
        description: 'You cannot delete your own account',
        variant: 'destructive',
      });
      return;
    }
    deleteUserMutation.mutate(userId);
  };

  const handleChangePassword = () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: 'Error',
        description: 'New passwords do not match',
        variant: 'destructive',
      });
      return;
    }
    changePasswordMutation.mutate(passwordData);
  };

  if (isUserLoading) {
    return <PageHeaderSkeleton />;
  }

  const isAdmin = currentUser?.role === 'admin';

  return (
    <PageLayout title="Settings" navItems={items}>
              <Tabs defaultValue={isAdmin ? "users" : "profile"} className="w-full">
                <TabsList className="mb-6">
                  {isAdmin && <TabsTrigger value="users">User Management</TabsTrigger>}
                  <TabsTrigger value="profile">Profile Settings</TabsTrigger>
                  <TabsTrigger value="tr-hs-codes">TR HS Codes</TabsTrigger>
                  <TabsTrigger value="products">Products</TabsTrigger>
                  {isAdmin && <TabsTrigger value="pdf-templates">PDF Templates</TabsTrigger>}
                </TabsList>

                {/* User Management Tab (Admin Only) */}
                {isAdmin && (
                  <TabsContent value="users">
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center">
                            <Users className="h-5 w-5 mr-2" />
                            User Management
                          </CardTitle>
                          <CardDescription>
                            Manage user accounts and permissions
                          </CardDescription>
                        </div>
                        <Button onClick={() => setShowCreateUserDialog(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add User
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {isUsersLoading ? (
                          <div className="text-center py-8">Loading users...</div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Username</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead>Last Login</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {usersData?.users?.map((user: User) => (
                                <TableRow key={user.id}>
                                  <TableCell className="font-medium">{user.username}</TableCell>
                                  <TableCell>{user.email || '—'}</TableCell>
                                  <TableCell>
                                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                                      {user.role}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                                  <TableCell>{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}</TableCell>
                                  <TableCell className="text-right">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm">
                                          <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleEditUser(user)}>
                                          <Edit className="h-4 w-4 mr-2" />
                                          Edit
                                        </DropdownMenuItem>
                                        {user.id !== currentUser?.id && (
                                          <DropdownMenuItem 
                                            onClick={() => handleDeleteUser(user.id)}
                                            className="text-red-600"
                                          >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Delete
                                          </DropdownMenuItem>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}

                {/* Profile Settings Tab */}
                <TabsContent value="profile">
                  <div className="grid gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Profile Information</CardTitle>
                        <CardDescription>
                          View and manage your account information
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Username</Label>
                            <Input value={currentUser?.username || ''} disabled />
                          </div>
                          <div>
                            <Label>Email</Label>
                            <Input value={currentUser?.email || ''} disabled />
                          </div>
                          <div>
                            <Label>Role</Label>
                            <Input value={currentUser?.role || ''} disabled />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <Key className="h-5 w-5 mr-2" />
                          Change Password
                        </CardTitle>
                        <CardDescription>
                          Update your account password
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button onClick={() => setShowPasswordDialog(true)}>
                          Change Password
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* TR HS Codes Tab */}
                <TabsContent value="tr-hs-codes">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center">
                          <Hash className="h-5 w-5 mr-2" />
                          TR HS Codes
                        </CardTitle>
                        <CardDescription>
                          Manage Turkish HS codes with tax rates and import requirements
                        </CardDescription>
                      </div>
                      <Button onClick={() => { setEditingHsCode(null); setHsCodeFormData({ tr_hs_code: '', ex_registry_form: false, azo_dye_test: false, special_custom: false, customs_tax_percent: '', additional_customs_tax_percent: '', kkdf_percent: '', vat_percent: '', description_tr: '', unit: '' }); setShowHsCodeDialog(true); }}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add HS Code
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isHsCodesLoading ? (
                        <div className="text-center py-8">Loading HS codes...</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>TR HS Code</TableHead>
                                <TableHead>Customs %</TableHead>
                                <TableHead>Add. Customs %</TableHead>
                                <TableHead>KKDF %</TableHead>
                                <TableHead>VAT %</TableHead>
                                <TableHead>Ex Reg Form</TableHead>
                                <TableHead>AZO Test</TableHead>
                                <TableHead>Special Customs</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {hsCodesData?.hsCodes?.map((hsCode: HsCode) => (
                                <TableRow key={hsCode.tr_hs_code} data-testid={`row-hscode-${hsCode.tr_hs_code}`}>
                                  <TableCell className="font-medium">{hsCode.tr_hs_code}</TableCell>
                                  <TableCell>{hsCode.customs_tax_percent || '—'}</TableCell>
                                  <TableCell>{hsCode.additional_customs_tax_percent || '—'}</TableCell>
                                  <TableCell>{hsCode.kkdf_percent || '—'}</TableCell>
                                  <TableCell>{hsCode.vat_percent || '—'}</TableCell>
                                  <TableCell><Badge variant={hsCode.ex_registry_form ? 'default' : 'secondary'}>{hsCode.ex_registry_form ? 'Yes' : 'No'}</Badge></TableCell>
                                  <TableCell><Badge variant={hsCode.azo_dye_test ? 'default' : 'secondary'}>{hsCode.azo_dye_test ? 'Yes' : 'No'}</Badge></TableCell>
                                  <TableCell><Badge variant={hsCode.special_custom ? 'default' : 'secondary'}>{hsCode.special_custom ? 'Yes' : 'No'}</Badge></TableCell>
                                  <TableCell className="text-right">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" data-testid={`button-hscode-menu-${hsCode.tr_hs_code}`}>
                                          <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleEditHsCode(hsCode)} data-testid={`button-edit-hscode-${hsCode.tr_hs_code}`}>
                                          <Edit className="h-4 w-4 mr-2" />
                                          Edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => deleteHsCodeMutation.mutate(hsCode.tr_hs_code)} className="text-red-600" data-testid={`button-delete-hscode-${hsCode.tr_hs_code}`}>
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {(!hsCodesData?.hsCodes || hsCodesData.hsCodes.length === 0) && (
                                <TableRow>
                                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No HS codes found. Click "Add HS Code" to create one.</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Products Tab */}
                <TabsContent value="products">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center">
                          <Package className="h-5 w-5 mr-2" />
                          Products
                        </CardTitle>
                        <CardDescription>
                          Manage products with style, HS codes, and descriptions
                        </CardDescription>
                      </div>
                      <Button onClick={() => { setEditingProduct(null); setProductFormData({ style: '', hts_code: '', tr_hs_code: '', item_description: '' }); setShowProductDialog(true); }}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Product
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isProductsLoading ? (
                        <div className="text-center py-8">Loading products...</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Style</TableHead>
                                <TableHead>HS Code (US)</TableHead>
                                <TableHead>TR HS Code</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {productsData?.products?.map((product: Product) => (
                                <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                                  <TableCell className="font-medium">{product.style || '—'}</TableCell>
                                  <TableCell>{product.hts_code || '—'}</TableCell>
                                  <TableCell>{product.tr_hs_code || '—'}</TableCell>
                                  <TableCell className="max-w-xs truncate">{product.item_description || '—'}</TableCell>
                                  <TableCell className="text-right">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" data-testid={`button-product-menu-${product.id}`}>
                                          <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleEditProduct(product)} data-testid={`button-edit-product-${product.id}`}>
                                          <Edit className="h-4 w-4 mr-2" />
                                          Edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => deleteProductMutation.mutate(product.id)} className="text-red-600" data-testid={`button-delete-product-${product.id}`}>
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {(!productsData?.products || productsData.products.length === 0) && (
                                <TableRow>
                                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No products found. Click "Add Product" to create one.</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* PDF Templates Tab (Admin Only) */}
                {isAdmin && (
                  <TabsContent value="pdf-templates">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <FileText className="h-5 w-5 mr-2" />
                          PDF Template Management
                        </CardTitle>
                        <CardDescription>
                          Upload and manage PDF generation templates
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-lg font-medium mb-2">Upload New Template</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                              Upload Adobe PDF document generation templates for generating reports.
                            </p>
                            <UploadTemplateForm />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}
              </Tabs>

      {/* Create User Dialog */}
      <Dialog open={showCreateUserDialog} onOpenChange={setShowCreateUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user to the system
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={newUserData.username}
                onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                placeholder="Enter username"
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newUserData.email}
                onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                placeholder="Enter email (optional)"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={newUserData.password}
                onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                placeholder="Enter password"
              />
            </div>
            <div>
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                value={newUserData.role}
                onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value as 'admin' | 'user' })}
                className="w-full p-2 border rounded-md"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateUserDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={createUserMutation.isPending}>
              {createUserMutation.isPending ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditUserDialog} onOpenChange={setShowEditUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-username">Username</Label>
                <Input
                  id="edit-username"
                  value={selectedUser.username}
                  onChange={(e) => setSelectedUser({ ...selectedUser, username: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={selectedUser.email || ''}
                  onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-role">Role</Label>
                <select
                  id="edit-role"
                  value={selectedUser.role}
                  onChange={(e) => setSelectedUser({ ...selectedUser, role: e.target.value as 'admin' | 'user' })}
                  className="w-full p-2 border rounded-md"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditUserDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateUser} disabled={updateUserMutation.isPending}>
              {updateUserMutation.isPending ? 'Updating...' : 'Update User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="current-password">Current Password</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showPassword ? "text" : "password"}
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                  placeholder="Enter current password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                placeholder="Enter new password"
              />
            </div>
            <div>
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword} disabled={changePasswordMutation.isPending}>
              {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HS Code Dialog */}
      <Dialog open={showHsCodeDialog} onOpenChange={(open) => { if (!open) resetHsCodeForm(); else setShowHsCodeDialog(true); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingHsCode ? 'Edit HS Code' : 'Add New HS Code'}</DialogTitle>
            <DialogDescription>
              {editingHsCode ? 'Update HS code information' : 'Enter the details for the new HS code'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="tr_hs_code">TR HS Code *</Label>
                <Input
                  id="tr_hs_code"
                  value={hsCodeFormData.tr_hs_code}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, tr_hs_code: e.target.value })}
                  placeholder="e.g., 6204.62.90.00.00"
                  disabled={!!editingHsCode}
                  data-testid="input-tr-hs-code"
                />
              </div>
              <div>
                <Label htmlFor="description_tr">Description</Label>
                <Input
                  id="description_tr"
                  value={hsCodeFormData.description_tr}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, description_tr: e.target.value })}
                  placeholder="Description in Turkish"
                  data-testid="input-description-tr"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label htmlFor="customs_tax_percent">Customs Tax %</Label>
                <Input
                  id="customs_tax_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.customs_tax_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, customs_tax_percent: e.target.value })}
                  placeholder="e.g., 12"
                  data-testid="input-customs-tax"
                />
              </div>
              <div>
                <Label htmlFor="additional_customs_tax_percent">Add. Customs %</Label>
                <Input
                  id="additional_customs_tax_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.additional_customs_tax_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, additional_customs_tax_percent: e.target.value })}
                  placeholder="e.g., 30"
                  data-testid="input-add-customs-tax"
                />
              </div>
              <div>
                <Label htmlFor="kkdf_percent">KKDF %</Label>
                <Input
                  id="kkdf_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.kkdf_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, kkdf_percent: e.target.value })}
                  placeholder="e.g., 6"
                  data-testid="input-kkdf"
                />
              </div>
              <div>
                <Label htmlFor="vat_percent">VAT %</Label>
                <Input
                  id="vat_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.vat_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, vat_percent: e.target.value })}
                  placeholder="e.g., 10"
                  data-testid="input-vat"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 pt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="ex_registry_form"
                  checked={hsCodeFormData.ex_registry_form}
                  onCheckedChange={(checked) => setHsCodeFormData({ ...hsCodeFormData, ex_registry_form: checked as boolean })}
                  data-testid="checkbox-ex-reg-form"
                />
                <Label htmlFor="ex_registry_form" className="cursor-pointer">Ex Registry Form Required</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="azo_dye_test"
                  checked={hsCodeFormData.azo_dye_test}
                  onCheckedChange={(checked) => setHsCodeFormData({ ...hsCodeFormData, azo_dye_test: checked as boolean })}
                  data-testid="checkbox-azo-test"
                />
                <Label htmlFor="azo_dye_test" className="cursor-pointer">AZO Dye Test Required</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="special_custom"
                  checked={hsCodeFormData.special_custom}
                  onCheckedChange={(checked) => setHsCodeFormData({ ...hsCodeFormData, special_custom: checked as boolean })}
                  data-testid="checkbox-special-custom"
                />
                <Label htmlFor="special_custom" className="cursor-pointer">Special Customs</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetHsCodeForm}>
              Cancel
            </Button>
            <Button onClick={handleSaveHsCode} disabled={createHsCodeMutation.isPending || updateHsCodeMutation.isPending} data-testid="button-save-hscode">
              {createHsCodeMutation.isPending || updateHsCodeMutation.isPending ? 'Saving...' : editingHsCode ? 'Update HS Code' : 'Create HS Code'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Dialog */}
      <Dialog open={showProductDialog} onOpenChange={(open) => { if (!open) resetProductForm(); else setShowProductDialog(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</DialogTitle>
            <DialogDescription>
              {editingProduct ? 'Update product information' : 'Enter the details for the new product'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="style">Style *</Label>
              <Input
                id="style"
                value={productFormData.style}
                onChange={(e) => setProductFormData({ ...productFormData, style: e.target.value })}
                placeholder="e.g., ABC-12345"
                data-testid="input-style"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="hts_code">HS Code (US)</Label>
                <Input
                  id="hts_code"
                  value={productFormData.hts_code}
                  onChange={(e) => setProductFormData({ ...productFormData, hts_code: e.target.value })}
                  placeholder="e.g., 6204.62.4010"
                  data-testid="input-hts-code"
                />
              </div>
              <div>
                <Label htmlFor="product_tr_hs_code">TR HS Code</Label>
                <Input
                  id="product_tr_hs_code"
                  value={productFormData.tr_hs_code}
                  onChange={(e) => setProductFormData({ ...productFormData, tr_hs_code: e.target.value })}
                  placeholder="e.g., 6204.62.90.00.00"
                  data-testid="input-product-tr-hs-code"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="item_description">Description</Label>
              <Input
                id="item_description"
                value={productFormData.item_description}
                onChange={(e) => setProductFormData({ ...productFormData, item_description: e.target.value })}
                placeholder="Product description"
                data-testid="input-item-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetProductForm}>
              Cancel
            </Button>
            <Button onClick={handleSaveProduct} disabled={createProductMutation.isPending || updateProductMutation.isPending} data-testid="button-save-product">
              {createProductMutation.isPending || updateProductMutation.isPending ? 'Saving...' : editingProduct ? 'Update Product' : 'Create Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

export default SettingsPage;
import React, { useState } from 'react';
import { useTranslation } from "react-i18next";
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
  Hash,
  ArrowUp,
  ArrowDown,
  Sparkles
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { UploadTemplateForm } from "@/components/ui/upload-template-form";
import { PageHeaderSkeleton } from "@/components/ui/branded-skeleton-loader";
import { PageLayout } from "@/components/layout/PageLayout";

interface User {
  id: number;
  username: string;
  email?: string;
  role: 'admin' | 'user' | 'accountant';
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
    title: "Ask CNC?",
    url: "/ask",
    icon: Sparkles,
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
    role: 'user' as 'admin' | 'user' | 'accountant'
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

  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("profile");
  
  // Sorting state for products
  const [sortColumn, setSortColumn] = useState<string>('style');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

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
        title: t('common.success'),
        description: t('settings.toast.userCreated'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setShowCreateUserDialog(false);
      setNewUserData({ username: '', email: '', password: '', role: 'user' });
    },
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: t('settings.toast.userCreateFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }),
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
        title: t('common.success'),
        description: t('settings.toast.userUpdated'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setShowEditUserDialog(false);
      setSelectedUser(null);
    },
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: t('settings.toast.userUpdateFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }),
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
        title: t('common.success'),
        description: t('settings.toast.userDeleted'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
    },
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: t('settings.toast.userDeleteFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }),
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
        title: t('common.success'),
        description: t('settings.toast.passwordChanged'),
      });
      setShowPasswordDialog(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: t('settings.toast.passwordChangeFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }),
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
      toast({ title: t('common.success'), description: t('settings.toast.hsCodeCreated') });
      queryClient.invalidateQueries({ queryKey: ['/api/hs-codes'] });
      resetHsCodeForm();
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: t('settings.toast.hsCodeCreateFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }), variant: 'destructive' });
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
      toast({ title: t('common.success'), description: t('settings.toast.hsCodeUpdated') });
      queryClient.invalidateQueries({ queryKey: ['/api/hs-codes'] });
      resetHsCodeForm();
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: t('settings.toast.hsCodeUpdateFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }), variant: 'destructive' });
    },
  });

  const deleteHsCodeMutation = useMutation({
    mutationFn: async (trHsCode: string) => {
      const response = await apiRequest('DELETE', `/api/hs-codes/${encodeURIComponent(trHsCode)}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('settings.toast.hsCodeDeleted') });
      queryClient.invalidateQueries({ queryKey: ['/api/hs-codes'] });
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: t('settings.toast.hsCodeDeleteFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }), variant: 'destructive' });
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
      toast({ title: t('common.success'), description: t('settings.toast.productCreated') });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      resetProductForm();
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: t('settings.toast.productCreateFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }), variant: 'destructive' });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof productFormData }) => {
      const response = await apiRequest('PUT', `/api/products/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('settings.toast.productUpdated') });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      resetProductForm();
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: t('settings.toast.productUpdateFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }), variant: 'destructive' });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/products/${id}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('settings.toast.productDeleted') });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: t('settings.toast.productDeleteFailed', { error: error instanceof Error ? error.message : t('settings.toast.unknownError') }), variant: 'destructive' });
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
      toast({ title: t('common.error'), description: t('settings.validation.trHsCodeRequired'), variant: 'destructive' });
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
      toast({ title: t('common.error'), description: t('settings.validation.styleRequired'), variant: 'destructive' });
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
        title: t('common.error'),
        description: t('settings.validation.usernamePasswordRequired'),
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
        title: t('common.error'),
        description: t('settings.validation.cannotDeleteOwnAccount'),
        variant: 'destructive',
      });
      return;
    }
    deleteUserMutation.mutate(userId);
  };

  const handleChangePassword = () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: t('common.error'),
        description: t('settings.validation.passwordsDoNotMatch'),
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
    <PageLayout title={t('nav.settings')} navItems={items}>
              <Tabs defaultValue={isAdmin ? "users" : "profile"} className="w-full">
                <TabsList className="mb-6">
                  {isAdmin && <TabsTrigger value="users">{t('settings.tabs.userManagement')}</TabsTrigger>}
                  <TabsTrigger value="profile">{t('settings.tabs.profileSettings')}</TabsTrigger>
                  <TabsTrigger value="tr-hs-codes">{t('settings.tabs.trHsCodes')}</TabsTrigger>
                  <TabsTrigger value="products">{t('settings.tabs.products')}</TabsTrigger>
                  {isAdmin && <TabsTrigger value="pdf-templates">{t('settings.tabs.pdfTemplates')}</TabsTrigger>}
                </TabsList>

                {/* User Management Tab (Admin Only) */}
                {isAdmin && (
                  <TabsContent value="users">
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center">
                            <Users className="h-5 w-5 mr-2" />
                            {t('settings.users.title')}
                          </CardTitle>
                          <CardDescription>
                            {t('settings.users.description')}
                          </CardDescription>
                        </div>
                        <Button onClick={() => setShowCreateUserDialog(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          {t('settings.users.addUser')}
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {isUsersLoading ? (
                          <div className="text-center py-8">{t('settings.users.loading')}</div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{t('settings.users.username')}</TableHead>
                                <TableHead>{t('settings.users.email')}</TableHead>
                                <TableHead>{t('settings.users.role')}</TableHead>
                                <TableHead>{t('settings.users.created')}</TableHead>
                                <TableHead>{t('settings.users.lastLogin')}</TableHead>
                                <TableHead className="text-right">{t('settings.users.actions')}</TableHead>
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
                                  <TableCell>{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : t('settings.users.never')}</TableCell>
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
                                          {t('settings.actions.edit')}
                                        </DropdownMenuItem>
                                        {user.id !== currentUser?.id && (
                                          <DropdownMenuItem
                                            onClick={() => handleDeleteUser(user.id)}
                                            className="text-red-600"
                                          >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            {t('settings.actions.delete')}
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
                        <CardTitle>{t('settings.profile.title')}</CardTitle>
                        <CardDescription>
                          {t('settings.profile.description')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>{t('settings.profile.username')}</Label>
                            <Input value={currentUser?.username || ''} disabled />
                          </div>
                          <div>
                            <Label>{t('settings.profile.email')}</Label>
                            <Input value={currentUser?.email || ''} disabled />
                          </div>
                          <div>
                            <Label>{t('settings.profile.role')}</Label>
                            <Input value={currentUser?.role || ''} disabled />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <Key className="h-5 w-5 mr-2" />
                          {t('settings.password.title')}
                        </CardTitle>
                        <CardDescription>
                          {t('settings.password.description')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button onClick={() => setShowPasswordDialog(true)}>
                          {t('settings.password.title')}
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
                          {t('settings.hsCodes.title')}
                        </CardTitle>
                        <CardDescription>
                          {t('settings.hsCodes.description')}
                        </CardDescription>
                      </div>
                      <Button onClick={() => { setEditingHsCode(null); setHsCodeFormData({ tr_hs_code: '', ex_registry_form: false, azo_dye_test: false, special_custom: false, customs_tax_percent: '', additional_customs_tax_percent: '', kkdf_percent: '', vat_percent: '', description_tr: '', unit: '' }); setShowHsCodeDialog(true); }}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t('settings.hsCodes.addHsCode')}
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isHsCodesLoading ? (
                        <div className="text-center py-8">{t('settings.hsCodes.loading')}</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{t('settings.hsCodes.colTrHsCode')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colCustoms')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colAddCustoms')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colKkdf')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colVat')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colExRegForm')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colAzoTest')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colSpecialCustoms')}</TableHead>
                                <TableHead className="text-right">{t('settings.users.actions')}</TableHead>
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
                                  <TableCell><Badge variant={hsCode.ex_registry_form ? 'default' : 'secondary'}>{hsCode.ex_registry_form ? t('settings.common.yes') : t('settings.common.no')}</Badge></TableCell>
                                  <TableCell><Badge variant={hsCode.azo_dye_test ? 'default' : 'secondary'}>{hsCode.azo_dye_test ? t('settings.common.yes') : t('settings.common.no')}</Badge></TableCell>
                                  <TableCell><Badge variant={hsCode.special_custom ? 'default' : 'secondary'}>{hsCode.special_custom ? t('settings.common.yes') : t('settings.common.no')}</Badge></TableCell>
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
                                          {t('settings.actions.edit')}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => deleteHsCodeMutation.mutate(hsCode.tr_hs_code)} className="text-red-600" data-testid={`button-delete-hscode-${hsCode.tr_hs_code}`}>
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          {t('settings.actions.delete')}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {(!hsCodesData?.hsCodes || hsCodesData.hsCodes.length === 0) && (
                                <TableRow>
                                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">{t('settings.hsCodes.empty')}</TableCell>
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
                          {t('settings.products.title')}
                        </CardTitle>
                        <CardDescription>
                          {t('settings.products.description')}
                        </CardDescription>
                      </div>
                      <Button onClick={() => { setEditingProduct(null); setProductFormData({ style: '', hts_code: '', tr_hs_code: '', item_description: '' }); setShowProductDialog(true); }}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t('settings.products.addProduct')}
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isProductsLoading ? (
                        <div className="text-center py-8">{t('settings.products.loading')}</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>
                                  <Button 
                                    variant="ghost" 
                                    onClick={() => handleSort('style')}
                                    className="hover:bg-transparent px-0 font-bold"
                                  >
                                    {t('settings.products.colStyle')}
                                    {sortColumn === 'style' && (
                                      sortDirection === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
                                    )}
                                  </Button>
                                </TableHead>
                                <TableHead>{t('settings.products.colHsCodeUs')}</TableHead>
                                <TableHead>
                                  <Button
                                    variant="ghost"
                                    onClick={() => handleSort('tr_hs_code')}
                                    className="hover:bg-transparent px-0 font-bold"
                                  >
                                    {t('settings.products.colTrHsCode')}
                                    {sortColumn === 'tr_hs_code' && (
                                      sortDirection === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
                                    )}
                                  </Button>
                                </TableHead>
                                <TableHead>{t('settings.products.colDescription')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colExRegForm')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colAzoTest')}</TableHead>
                                <TableHead>{t('settings.hsCodes.colSpecialCustoms')}</TableHead>
                                <TableHead className="text-right">{t('settings.users.actions')}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {productsData?.products?.sort((a: Product, b: Product) => {
                                const aValue = (a[sortColumn as keyof Product] as string) || '';
                                const bValue = (b[sortColumn as keyof Product] as string) || '';
                                const comparison = aValue.localeCompare(bValue);
                                
                                return sortDirection === 'asc' ? comparison : -comparison;
                              }).map((product: Product) => {
                                // Find matching HS Code data
                                const hsCodeData = hsCodesData?.hsCodes?.find((h: HsCode) => h.tr_hs_code === product.tr_hs_code);
                                
                                return (
                                <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                                  <TableCell className="font-medium">{product.style || '—'}</TableCell>
                                  <TableCell>{product.hts_code || '—'}</TableCell>
                                  <TableCell>{product.tr_hs_code || '—'}</TableCell>
                                  <TableCell className="max-w-xs truncate">{product.item_description || '—'}</TableCell>
                                  <TableCell>
                                    {hsCodeData ? (
                                      <Badge variant={hsCodeData.ex_registry_form ? 'default' : 'secondary'}>
                                        {hsCodeData.ex_registry_form ? t('settings.common.yes') : t('settings.common.no')}
                                      </Badge>
                                    ) : '—'}
                                  </TableCell>
                                  <TableCell>
                                    {hsCodeData ? (
                                      <Badge variant={hsCodeData.azo_dye_test ? 'default' : 'secondary'}>
                                        {hsCodeData.azo_dye_test ? t('settings.common.yes') : t('settings.common.no')}
                                      </Badge>
                                    ) : '—'}
                                  </TableCell>
                                  <TableCell>
                                    {hsCodeData ? (
                                      <Badge variant={hsCodeData.special_custom ? 'default' : 'secondary'}>
                                        {hsCodeData.special_custom ? t('settings.common.yes') : t('settings.common.no')}
                                      </Badge>
                                    ) : '—'}
                                  </TableCell>
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
                                          {t('settings.actions.edit')}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => deleteProductMutation.mutate(product.id)} className="text-red-600" data-testid={`button-delete-product-${product.id}`}>
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          {t('settings.actions.delete')}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              )})}
                              {(!productsData?.products || productsData.products.length === 0) && (
                                <TableRow>
                                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">{t('settings.products.empty')}</TableCell>
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
                          {t('settings.pdfTemplates.title')}
                        </CardTitle>
                        <CardDescription>
                          {t('settings.pdfTemplates.description')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-lg font-medium mb-2">{t('settings.pdfTemplates.uploadNew')}</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                              {t('settings.pdfTemplates.uploadHint')}
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
            <DialogTitle>{t('settings.createUserDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.createUserDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="username">{t('settings.users.username')}</Label>
              <Input
                id="username"
                value={newUserData.username}
                onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                placeholder={t('settings.createUserDialog.usernamePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="email">{t('settings.users.email')}</Label>
              <Input
                id="email"
                type="email"
                value={newUserData.email}
                onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                placeholder={t('settings.createUserDialog.emailPlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="password">{t('settings.createUserDialog.password')}</Label>
              <Input
                id="password"
                type="password"
                value={newUserData.password}
                onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                placeholder={t('settings.createUserDialog.passwordPlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="role">{t('settings.users.role')}</Label>
              <select
                id="role"
                value={newUserData.role}
                onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value as 'admin' | 'user' | 'accountant' })}
                className="w-full p-2 border rounded-md"
              >
                <option value="user">{t('settings.roles.user')}</option>
                <option value="accountant">{t('settings.roles.accountant')}</option>
                <option value="admin">{t('settings.roles.admin')}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateUserDialog(false)}>
              {t('settings.actions.cancel')}
            </Button>
            <Button onClick={handleCreateUser} disabled={createUserMutation.isPending}>
              {createUserMutation.isPending ? t('settings.createUserDialog.creating') : t('settings.createUserDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditUserDialog} onOpenChange={setShowEditUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.editUserDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.editUserDialog.description')}
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-username">{t('settings.users.username')}</Label>
                <Input
                  id="edit-username"
                  value={selectedUser.username}
                  onChange={(e) => setSelectedUser({ ...selectedUser, username: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-email">{t('settings.users.email')}</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={selectedUser.email || ''}
                  onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-role">{t('settings.users.role')}</Label>
                <select
                  id="edit-role"
                  value={selectedUser.role}
                  onChange={(e) => setSelectedUser({ ...selectedUser, role: e.target.value as 'admin' | 'user' | 'accountant' })}
                  className="w-full p-2 border rounded-md"
                >
                  <option value="user">{t('settings.roles.user')}</option>
                  <option value="accountant">{t('settings.roles.accountant')}</option>
                  <option value="admin">{t('settings.roles.admin')}</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditUserDialog(false)}>
              {t('settings.actions.cancel')}
            </Button>
            <Button onClick={handleUpdateUser} disabled={updateUserMutation.isPending}>
              {updateUserMutation.isPending ? t('settings.editUserDialog.updating') : t('settings.editUserDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.password.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.passwordDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="current-password">{t('settings.passwordDialog.current')}</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showPassword ? "text" : "password"}
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                  placeholder={t('settings.passwordDialog.currentPlaceholder')}
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
              <Label htmlFor="new-password">{t('settings.passwordDialog.new')}</Label>
              <Input
                id="new-password"
                type="password"
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                placeholder={t('settings.passwordDialog.newPlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="confirm-password">{t('settings.passwordDialog.confirm')}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                placeholder={t('settings.passwordDialog.confirmPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              {t('settings.actions.cancel')}
            </Button>
            <Button onClick={handleChangePassword} disabled={changePasswordMutation.isPending}>
              {changePasswordMutation.isPending ? t('settings.passwordDialog.changing') : t('settings.password.title')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HS Code Dialog */}
      <Dialog open={showHsCodeDialog} onOpenChange={(open) => { if (!open) resetHsCodeForm(); else setShowHsCodeDialog(true); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingHsCode ? t('settings.hsCodeDialog.editTitle') : t('settings.hsCodeDialog.addTitle')}</DialogTitle>
            <DialogDescription>
              {editingHsCode ? t('settings.hsCodeDialog.editDescription') : t('settings.hsCodeDialog.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="tr_hs_code">{t('settings.hsCodeDialog.trHsCodeRequired')}</Label>
                <Input
                  id="tr_hs_code"
                  value={hsCodeFormData.tr_hs_code}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, tr_hs_code: e.target.value })}
                  placeholder={t('settings.hsCodeDialog.trHsCodePlaceholder')}
                  disabled={!!editingHsCode}
                  data-testid="input-tr-hs-code"
                />
              </div>
              <div>
                <Label htmlFor="description_tr">{t('settings.products.colDescription')}</Label>
                <Input
                  id="description_tr"
                  value={hsCodeFormData.description_tr}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, description_tr: e.target.value })}
                  placeholder={t('settings.hsCodeDialog.descriptionPlaceholder')}
                  data-testid="input-description-tr"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label htmlFor="customs_tax_percent">{t('settings.hsCodeDialog.customsTax')}</Label>
                <Input
                  id="customs_tax_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.customs_tax_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, customs_tax_percent: e.target.value })}
                  placeholder={t('settings.hsCodeDialog.exampleValue', { value: '12' })}
                  data-testid="input-customs-tax"
                />
              </div>
              <div>
                <Label htmlFor="additional_customs_tax_percent">{t('settings.hsCodes.colAddCustoms')}</Label>
                <Input
                  id="additional_customs_tax_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.additional_customs_tax_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, additional_customs_tax_percent: e.target.value })}
                  placeholder={t('settings.hsCodeDialog.exampleValue', { value: '30' })}
                  data-testid="input-add-customs-tax"
                />
              </div>
              <div>
                <Label htmlFor="kkdf_percent">{t('settings.hsCodes.colKkdf')}</Label>
                <Input
                  id="kkdf_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.kkdf_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, kkdf_percent: e.target.value })}
                  placeholder={t('settings.hsCodeDialog.exampleValue', { value: '6' })}
                  data-testid="input-kkdf"
                />
              </div>
              <div>
                <Label htmlFor="vat_percent">{t('settings.hsCodes.colVat')}</Label>
                <Input
                  id="vat_percent"
                  type="number"
                  step="0.01"
                  value={hsCodeFormData.vat_percent}
                  onChange={(e) => setHsCodeFormData({ ...hsCodeFormData, vat_percent: e.target.value })}
                  placeholder={t('settings.hsCodeDialog.exampleValue', { value: '10' })}
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
                <Label htmlFor="ex_registry_form" className="cursor-pointer">{t('settings.hsCodeDialog.exRegistryRequired')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="azo_dye_test"
                  checked={hsCodeFormData.azo_dye_test}
                  onCheckedChange={(checked) => setHsCodeFormData({ ...hsCodeFormData, azo_dye_test: checked as boolean })}
                  data-testid="checkbox-azo-test"
                />
                <Label htmlFor="azo_dye_test" className="cursor-pointer">{t('settings.hsCodeDialog.azoDyeRequired')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="special_custom"
                  checked={hsCodeFormData.special_custom}
                  onCheckedChange={(checked) => setHsCodeFormData({ ...hsCodeFormData, special_custom: checked as boolean })}
                  data-testid="checkbox-special-custom"
                />
                <Label htmlFor="special_custom" className="cursor-pointer">{t('settings.hsCodes.colSpecialCustoms')}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetHsCodeForm}>
              {t('settings.actions.cancel')}
            </Button>
            <Button onClick={handleSaveHsCode} disabled={createHsCodeMutation.isPending || updateHsCodeMutation.isPending} data-testid="button-save-hscode">
              {createHsCodeMutation.isPending || updateHsCodeMutation.isPending ? t('settings.actions.saving') : editingHsCode ? t('settings.hsCodeDialog.update') : t('settings.hsCodeDialog.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Dialog */}
      <Dialog open={showProductDialog} onOpenChange={(open) => { if (!open) resetProductForm(); else setShowProductDialog(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? t('settings.productDialog.editTitle') : t('settings.productDialog.addTitle')}</DialogTitle>
            <DialogDescription>
              {editingProduct ? t('settings.productDialog.editDescription') : t('settings.productDialog.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="style">{t('settings.productDialog.styleRequired')}</Label>
              <Input
                id="style"
                value={productFormData.style}
                onChange={(e) => setProductFormData({ ...productFormData, style: e.target.value })}
                placeholder={t('settings.productDialog.stylePlaceholder')}
                data-testid="input-style"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="hts_code">{t('settings.products.colHsCodeUs')}</Label>
                <Input
                  id="hts_code"
                  value={productFormData.hts_code}
                  onChange={(e) => setProductFormData({ ...productFormData, hts_code: e.target.value })}
                  placeholder={t('settings.productDialog.htsCodePlaceholder')}
                  data-testid="input-hts-code"
                />
              </div>
              <div>
                <Label htmlFor="product_tr_hs_code">{t('settings.products.colTrHsCode')}</Label>
                <Input
                  id="product_tr_hs_code"
                  value={productFormData.tr_hs_code}
                  onChange={(e) => setProductFormData({ ...productFormData, tr_hs_code: e.target.value })}
                  placeholder={t('settings.hsCodeDialog.trHsCodePlaceholder')}
                  data-testid="input-product-tr-hs-code"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="item_description">{t('settings.products.colDescription')}</Label>
              <Input
                id="item_description"
                value={productFormData.item_description}
                onChange={(e) => setProductFormData({ ...productFormData, item_description: e.target.value })}
                placeholder={t('settings.productDialog.descriptionPlaceholder')}
                data-testid="input-item-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetProductForm}>
              {t('settings.actions.cancel')}
            </Button>
            <Button onClick={handleSaveProduct} disabled={createProductMutation.isPending || updateProductMutation.isPending} data-testid="button-save-product">
              {createProductMutation.isPending || updateProductMutation.isPending ? t('settings.actions.saving') : editingProduct ? t('settings.productDialog.update') : t('settings.productDialog.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

export default SettingsPage;
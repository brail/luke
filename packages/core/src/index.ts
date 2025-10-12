import { z } from 'zod';

// Base schemas
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const AppConfigSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  value: z.string(),
  encrypted: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// RBAC schemas
export const PermissionSchema = z.object({
  resource: z.string().min(1),
  action: z.enum(['create', 'read', 'update', 'delete', 'manage']),
});

export const RoleSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(PermissionSchema),
});

// API schemas
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  traceId: z.string().uuid().optional(),
});

// Types
export type User = z.infer<typeof UserSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type ApiResponse<T = any> = z.infer<typeof ApiResponseSchema> & {
  data?: T;
};

// Utility functions
export const createApiResponse = <T>(data: T, success = true): ApiResponse<T> => ({
  success,
  data,
});

export const createApiError = (error: string, traceId?: string): ApiResponse => ({
  success: false,
  error,
  traceId,
});

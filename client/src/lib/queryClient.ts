import { QueryClient, QueryFunction } from "@tanstack/react-query";
import axios, { AxiosResponse } from "axios";
import { toast } from "@/hooks/use-toast";

// Helper function to get clean, user-friendly error messages without HTTP status codes
function getCleanErrorMessage(serverMessage: string, statusCode: number): string {
  // Handle common authentication errors with user-friendly messages
  if (statusCode === 401) {
    if (serverMessage.toLowerCase().includes('invalid credentials') || 
        serverMessage.toLowerCase().includes('invalid email') ||
        serverMessage.toLowerCase().includes('invalid password')) {
      return 'Invalid email or password.';
    }
    if (serverMessage.toLowerCase().includes('account not set up')) {
      return 'Your account is not set up yet. Please check your email for setup instructions.';
    }
    return 'Invalid email or password.';
  }
  
  if (statusCode === 403) {
    return 'You do not have permission to perform this action.';
  }
  
  if (statusCode === 404) {
    return 'The requested resource was not found.';
  }
  
  if (statusCode >= 500) {
    return 'A server error occurred. Please try again later.';
  }
  
  // Return the server message if it doesn't contain a status code prefix
  if (serverMessage && !serverMessage.match(/^\d{3}:/)) {
    return serverMessage;
  }
  
  return 'Something went wrong. Please try again.';
}

// Configure axios defaults
axios.defaults.withCredentials = true;

// Track if user was previously authenticated to detect session expiration
let wasAuthenticated = false;

// Add axios interceptor for session expiration
axios.interceptors.response.use(
  (response) => {
    // Track successful authentication responses
    if (response.config.url?.includes('/api/auth/user') && response.status === 200) {
      wasAuthenticated = true;
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      const currentPath = window.location.pathname;
      const requestUrl = error.config?.url || '';
      
      // Don't redirect if:
      // 1. Already on a login page
      // 2. The request is to a login endpoint
      // 3. User was never authenticated (first page load)
      const isLoginPage = currentPath.startsWith('/login') || 
                         currentPath.startsWith('/instructor-login') || 
                         currentPath.startsWith('/student-login');
      
      const isLoginRequest = requestUrl.includes('/login') || requestUrl.includes('/api/auth/user');
      
      // Only show session expired if user was previously logged in
      if (!isLoginPage && !isLoginRequest && wasAuthenticated) {
        toast({
          title: "Session Expired",
          description: "Your session has expired. Please log in again.",
          variant: "destructive",
        });
        
        // Reset the flag
        wasAuthenticated = false;
        
        // Redirect to appropriate login page based on current route
        setTimeout(() => {
          if (currentPath.startsWith('/instructor')) {
            window.location.href = '/instructor-login';
          } else if (currentPath.startsWith('/student')) {
            window.location.href = '/student-login';
          } else {
            window.location.href = '/login';
          }
        }, 1500);
      }
    }
    return Promise.reject(error);
  }
);

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  try {
    const response: AxiosResponse = await axios({
      method: method.toLowerCase(),
      url,
      data,
      headers: {
        "Content-Type": "application/json",
      },
      withCredentials: true,
    });
    
    return response.data;
  } catch (error: any) {
    if (error.response) {
      // Use user-friendly error messages without HTTP status codes
      const serverMessage = error.response.data?.message || error.response.statusText;
      const userFriendlyMessage = getCleanErrorMessage(serverMessage, error.response.status);
      const errorObj = new Error(userFriendlyMessage);
      (errorObj as any).data = error.response.data;
      (errorObj as any).status = error.response.status;
      throw errorObj;
    } else if (error.request) {
      throw new Error("Unable to connect to the server. Please check your internet connection.");
    } else {
      throw new Error("Something went wrong. Please try again.");
    }
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      const response = await axios.get(queryKey[0] as string, {
        withCredentials: true,
      });
      
      return response.data;
    } catch (error: any) {
      if (unauthorizedBehavior === "returnNull" && error.response?.status === 401) {
        return null;
      }
      
      if (error.response) {
        const serverMessage = error.response.data?.message || error.response.statusText;
        const userFriendlyMessage = getCleanErrorMessage(serverMessage, error.response.status);
        throw new Error(userFriendlyMessage);
      } else if (error.request) {
        throw new Error("Unable to connect to the server. Please check your internet connection.");
      } else {
        throw new Error("Something went wrong. Please try again.");
      }
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

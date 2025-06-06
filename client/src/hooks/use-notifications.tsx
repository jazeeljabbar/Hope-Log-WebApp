import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Notification, NotificationPreferences } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function useNotifications() {
  const { toast } = useToast();
  const [isMarkingAsRead, setIsMarkingAsRead] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Fetch all notifications
  const { 
    data: notifications = [], 
    isLoading,
    error,
    refetch
  } = useQuery<Notification[]>({
    queryKey: ['/api/notifications'],
    retry: 1,
  });

  // Fetch unread notifications
  const { 
    data: unreadNotifications = [] 
  } = useQuery<Notification[]>({
    queryKey: ['/api/notifications/unread'],
    retry: 1,
  });

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (id: number) => {
      setIsMarkingAsRead(true);
      try {
        const response = await apiRequest('PATCH', `/api/notifications/${id}`, { status: 'read' });
        return await response.json();
      } finally {
        setIsMarkingAsRead(false);
      }
    },
    onSuccess: () => {
      // Invalidate both notifications queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread'] });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to mark notification as read: ${error.message}`,
        variant: 'destructive',
      });
    }
  });

  // Delete notification
  const deleteNotificationMutation = useMutation({
    mutationFn: async (id: number) => {
      setIsDeleting(true);
      try {
        await apiRequest('DELETE', `/api/notifications/${id}`);
      } finally {
        setIsDeleting(false);
      }
    },
    onSuccess: () => {
      // Invalidate both notifications queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread'] });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to delete notification: ${error.message}`,
        variant: 'destructive',
      });
    }
  });

  // Clear all notifications
  const clearAllNotificationsMutation = useMutation({
    mutationFn: async () => {
      setIsClearing(true);
      try {
        await apiRequest('DELETE', '/api/notifications');
      } finally {
        setIsClearing(false);
      }
    },
    onSuccess: () => {
      // Invalidate both notifications queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread'] });
      
      toast({
        title: 'Success',
        description: 'All notifications cleared',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to clear notifications: ${error.message}`,
        variant: 'destructive',
      });
    }
  });

  // Wrapper functions for mutations
  const markAsRead = (id: number) => markAsReadMutation.mutate(id);
  const deleteNotification = (id: number) => deleteNotificationMutation.mutate(id);
  const clearAllNotifications = () => clearAllNotificationsMutation.mutate();

  return {
    notifications,
    unreadNotifications,
    isLoading,
    error,
    refetch,
    markAsRead,
    deleteNotification,
    clearAllNotifications,
    isMarkingAsRead,
    isDeleting,
    isClearing
  };
}

export function useNotificationPreferences() {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Fetch notification preferences
  const { 
    data: preferences,
    isLoading,
    error,
    refetch
  } = useQuery<NotificationPreferences>({
    queryKey: ['/api/notification-preferences'],
    retry: 1,
  });
  
  // Update notification preferences
  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: Partial<NotificationPreferences>) => {
      setIsUpdating(true);
      try {
        const response = await apiRequest('PATCH', '/api/notification-preferences', data);
        return await response.json();
      } finally {
        setIsUpdating(false);
      }
    },
    onSuccess: () => {
      // Invalidate preferences query to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/notification-preferences'] });
      
      toast({
        title: 'Preferences updated',
        description: 'Your notification preferences have been updated',
      });
    },
    onError: (error) => {
      toast({
        title: 'Update failed',
        description: `Failed to update preferences: ${error.message}`,
        variant: 'destructive',
      });
    }
  });
  
  // Wrapper function for mutation
  const updatePreferences = (data: Partial<NotificationPreferences>) => 
    updatePreferencesMutation.mutate(data);
  
  return {
    preferences,
    isLoading,
    error,
    refetch,
    updatePreferences,
    isUpdating
  };
}
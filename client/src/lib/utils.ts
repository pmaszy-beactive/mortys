import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(num);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatTime(timeString: string): string {
  const [hours, minutes] = timeString.split(':');
  const date = new Date();
  date.setHours(parseInt(hours), parseInt(minutes));
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

export function getCourseColor(courseType: string): string {
  switch (courseType) {
    case "auto": return "bg-blue-100 text-blue-800";
    case "moto": return "bg-green-100 text-green-800";
    case "scooter": return "bg-purple-100 text-purple-800";
    default: return "bg-gray-100 text-gray-800";
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "active": return "bg-green-100 text-green-800";
    case "completed": return "bg-blue-100 text-blue-800";
    case "pending": return "bg-yellow-100 text-yellow-800";
    case "on-hold": return "bg-yellow-100 text-yellow-800";
    case "cancelled": return "bg-red-100 text-red-800";
    case "transferred": return "bg-gray-100 text-gray-800";
    case "sent": return "bg-green-100 text-green-800";
    case "scheduled": return "bg-yellow-100 text-yellow-800";
    case "draft": return "bg-gray-100 text-gray-800";
    default: return "bg-gray-100 text-gray-800";
  }
}

export function getCoursePrice(courseType: string): number {
  switch (courseType) {
    case "auto": return 1200;
    case "moto": return 800;
    case "scooter": return 600;
    default: return 0;
  }
}

export function generateAttestationNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ATT-${year}-${random}`;
}

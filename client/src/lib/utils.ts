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
  if (!dateString) return '';
  // Parse YYYY-MM-DD manually to avoid timezone shift issues
  const parts = dateString.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }
  // Fallback for other date formats
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
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
    case "auto": return 1130;
    case "moto": return 1100;
    case "scooter": return 375;
    default: return 0;
  }
}

export function isPermitExpired(expiryDateString: string): boolean {
  if (!expiryDateString) return false;
  // Parse date-only strings (YYYY-MM-DD) as local dates so the permit
  // is not treated as expired on the expiry day itself due to UTC parsing.
  const datePart = expiryDateString.split('T')[0];
  const parts = datePart.split('-');
  let expiry: Date;
  if (parts.length === 3 && parts[0].length === 4) {
    expiry = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  } else {
    expiry = new Date(expiryDateString);
    if (isNaN(expiry.getTime())) return false;
  }
  // Valid through the end of the expiry day
  expiry.setHours(23, 59, 59, 999);
  return expiry < new Date();
}

export function daysUntilPermitExpiry(expiryDateString: string): number | null {
  if (!expiryDateString) return null;
  // Parse date-only strings (YYYY-MM-DD) as local dates to avoid UTC drift.
  const datePart = expiryDateString.split('T')[0];
  const parts = datePart.split('-');
  let expiry: Date;
  if (parts.length === 3 && parts[0].length === 4) {
    expiry = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  } else {
    expiry = new Date(expiryDateString);
    if (isNaN(expiry.getTime())) return null;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export function isPermitExpiringSoon(expiryDateString: string, withinDays: number = 30): boolean {
  const days = daysUntilPermitExpiry(expiryDateString);
  return days !== null && days >= 0 && days <= withinDays;
}

export function generateAttestationNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ATT-${year}-${random}`;
}

import { UserDatabaseEntry, UserProfile, SavedInquiry } from '../types';

const USERS = Array.from({ length: 9 }, (_, i) => ({
  username: `DMDsetup#${i + 1}`,
  password: `${52011 + i}`
}));

const CURRENT_USER_KEY = 'hanzhi_current_user';
const DB_PREFIX = 'hanzhi_db_';

// Simulating network delay for realistic feel
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const login = async (username: string, password: string): Promise<boolean> => {
  await delay(600); // Simulate API call
  const user = USERS.find(u => u.username === username && u.password === password);
  
  if (user) {
    localStorage.setItem(CURRENT_USER_KEY, user.username);
    
    // Note: In a real cross-device application, we would fetch the user's data 
    // from a cloud database here. For this demo, we persist to localStorage.
    // e.g., const cloudData = await api.getUserData(token);
    // localStorage.setItem(DB_PREFIX + user.username, JSON.stringify(cloudData));

    // Initialize Local DB if empty
    if (!localStorage.getItem(DB_PREFIX + user.username)) {
      const initialData: UserDatabaseEntry = {
        username: user.username,
        profile: null,
        savedInquiries: [],
        rehabRecords: [],
        rehabStatusHistory: []
      };
      localStorage.setItem(DB_PREFIX + user.username, JSON.stringify(initialData));
    }
    return true;
  }
  return false;
};

export const logout = async () => {
  await delay(200);
  localStorage.removeItem(CURRENT_USER_KEY);
};

export const getCurrentUser = (): string | null => {
  return localStorage.getItem(CURRENT_USER_KEY);
};

export const getUserData = (): UserDatabaseEntry | null => {
  const username = getCurrentUser();
  if (!username) return null;
  const data = localStorage.getItem(DB_PREFIX + username);
  return data ? JSON.parse(data) : null;
};

export const saveUserProfile = async (profile: UserProfile): Promise<void> => {
  await delay(300); // Simulate save delay
  const username = getCurrentUser();
  if (!username) return;
  const data = getUserData();
  if (data) {
    data.profile = profile;
    localStorage.setItem(DB_PREFIX + username, JSON.stringify(data));
    // In real app: await api.saveProfile(profile);
  }
};

export const saveInquiry = async (inquiry: SavedInquiry): Promise<void> => {
  // No artificial delay for UX on this one usually, but consistent for async
  const username = getCurrentUser();
  if (!username) return;
  const data = getUserData();
  if (data) {
    // Check if already saved (update) or new
    const existingIndex = data.savedInquiries.findIndex(s => s.id === inquiry.id);
    if (existingIndex >= 0) {
      data.savedInquiries[existingIndex] = inquiry;
    } else {
      data.savedInquiries.unshift(inquiry);
    }
    localStorage.setItem(DB_PREFIX + username, JSON.stringify(data));
    // In real app: await api.saveInquiry(inquiry);
  }
};
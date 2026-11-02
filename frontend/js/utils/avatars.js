export const avatars = [
  { id: 'reading', label: 'Nino lendo', src: '/assets/brand/avatars/reading.png' },
  { id: 'listening', label: 'Nino com fones', src: '/assets/brand/avatars/listening.png' },
  { id: 'glasses', label: 'Nino de óculos', src: '/assets/brand/avatars/glasses.png' },
  { id: 'curious', label: 'Nino curioso', src: '/assets/brand/avatars/curious.png' },
  { id: 'happy', label: 'Nino sorrindo', src: '/assets/brand/avatars/happy.png' },
  { id: 'laptop', label: 'Nino com notebook', src: '/assets/brand/avatars/laptop.png' },
  { id: 'rest', label: 'Nino descansando', src: '/assets/brand/avatars/rest.png' },
  { id: 'celebrate', label: 'Nino comemorando', src: '/assets/brand/avatars/celebrate.png' },
];
export const getAvatar = (id) => avatars.find((a) => a.id === id) || avatars[0];

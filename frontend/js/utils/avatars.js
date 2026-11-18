export const avatars = [
  { id: 'reading', label: 'Nino lendo', src: '/assets/brand/avatars/reading.png?v=nino-20261118' },
  { id: 'listening', label: 'Nino com fones', src: '/assets/brand/avatars/listening.png?v=nino-20261118' },
  { id: 'glasses', label: 'Nino de óculos', src: '/assets/brand/avatars/glasses.png?v=nino-20261118' },
  { id: 'curious', label: 'Nino curioso', src: '/assets/brand/avatars/curious.png?v=nino-20261118' },
  { id: 'happy', label: 'Nino sorrindo', src: '/assets/brand/avatars/happy.png?v=nino-20261118' },
  { id: 'laptop', label: 'Nino com notebook', src: '/assets/brand/avatars/laptop.png?v=nino-20261118' },
  { id: 'rest', label: 'Nino descansando', src: '/assets/brand/avatars/rest.png?v=nino-20261118' },
  { id: 'celebrate', label: 'Nino comemorando', src: '/assets/brand/avatars/celebrate.png?v=nino-20261118' },
];
export const getAvatar = (id) => avatars.find((a) => a.id === id) || avatars[0];

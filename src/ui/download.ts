/** Offer text as a file download. Used for backups and for rescuing data that could not be opened. */
export const downloadText = (filename: string, text: string, type = 'application/json'): void => {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

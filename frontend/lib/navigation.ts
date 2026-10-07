export function navigate(path: string) {
  window.location.assign(path);
}

export function replaceLocation(path: string) {
  window.location.replace(path);
}

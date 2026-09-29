const PALETTE = {
  A: { bg: '#1E4D8C', text: '#FFFFFF', soft: '#E3EEF8' },
  C: { bg: '#2B59FF', text: '#FFFFFF', soft: '#E8EDFF' },
  I: { bg: '#E8196F', text: '#FFFFFF', soft: '#FDE7F0' },
  F: { bg: '#0A8F5B', text: '#FFFFFF', soft: '#E3F6EE' },
  E: { bg: '#FF7A00', text: '#101828', soft: '#FFF0E0' },
  H: { bg: '#7A3CF0', text: '#FFFFFF', soft: '#F0E9FE' },
}

const FALLBACK = Object.values(PALETTE)

export function serviceColor(service) {
  const code = (service?.code || '').toUpperCase()
  if (PALETTE[code]) return PALETTE[code]
  const id = service?.id ?? 0
  return FALLBACK[id % 5]
}

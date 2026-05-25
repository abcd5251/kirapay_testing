export const extractEthereumAddresses = (text: string | null): string[] => {
  if (!text) {
    return []
  }

  // Ethereum addresses are 42 characters: 0x followed by 40 hex characters
  const ethereumAddressRegex = /0x[a-fA-F0-9]{40}/g
  const matches = text.match(ethereumAddressRegex) || []

  // Filter out any potential false positives (though the regex is already quite specific)
  const validAddresses = matches.filter((address) => {
    // Optional: Add additional validation if needed
    // For example, checksum validation could be added here
    return address.length === 42
  })

  return validAddresses
}

export const extractSolanaAddresses = (text: string | null): string[] => {
  if (!text) {
    return []
  }

  // First find all ethereum addresses and signatures to exclude
  const ethereumPatternRegex = /0x[a-fA-F0-9]{40,}/g // 40 or more hex chars after 0x
  const ethereumMatches = text.match(ethereumPatternRegex) || []

  // Create a clean text by removing ethereum patterns
  let cleanText = text
  ethereumMatches.forEach((match) => {
    cleanText = cleanText.replace(match, '')
  })

  // Now find Solana addresses in the clean text that are separated by non-alphanumeric characters
  // We use a regex with a positive lookbehind and lookahead to ensure boundaries
  const matches: string[] = []

  // We need to use a regex with capture groups since JavaScript doesn't fully support lookbehind
  const solanaAddressRegex = /(^|[^a-zA-Z0-9])([1-9A-Za-z]{32,44})([^a-zA-Z0-9]|$)/g

  let match
  while ((match = solanaAddressRegex.exec(cleanText)) !== null) {
    // The address is in capture group 2
    matches.push(match[2])
  }

  return matches
}

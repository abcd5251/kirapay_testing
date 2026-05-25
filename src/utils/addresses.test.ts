import { describe, it, expect } from 'vitest'
import { extractEthereumAddresses, extractSolanaAddresses } from './addresses'

describe('extractEthereumAddresses', () => {
  it('should extract Ethereum addresses', () => {
    const addresses = extractEthereumAddresses(
      '0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f4 0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f5'
    )
    expect(addresses).toEqual([
      '0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f4',
      '0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f5'
    ])
  })

  it('should return an empty array for null input', () => {
    const addresses = extractEthereumAddresses(null)
    expect(addresses).toEqual([])
  })

  it('should return an empty array when no addresses are found', () => {
    const addresses = extractEthereumAddresses('No ethereum addresses here')
    expect(addresses).toEqual([])
  })

  it('should extract addresses from text with other content', () => {
    const addresses = extractEthereumAddresses(
      "My wallet address is 0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f4 and my friend's is 0x1234567890123456789012345678901234567890."
    )
    expect(addresses).toEqual([
      '0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f4',
      '0x1234567890123456789012345678901234567890'
    ])
  })

  it('should not extract invalid length addresses', () => {
    const addresses = extractEthereumAddresses(
      '0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f4ab 0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8'
    )
    expect(addresses).toEqual(['0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f4'])
  })
})

describe('extractSolanaAddresses', () => {
  it.only('should extract Solana addresses', () => {
    const addresses = extractSolanaAddresses('gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu')
    expect(addresses).toEqual(['gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu'])
  })

  it('should extract Solana addresses from URLs', () => {
    const addresses = extractSolanaAddresses(
      'https://dexscreener.com/solana/gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu'
    )
    expect(addresses).toEqual(['gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu'])
  })

  it('should return an empty array for null input', () => {
    const addresses = extractSolanaAddresses(null)
    expect(addresses).toEqual([])
  })

  it('should return an empty array when no addresses are found', () => {
    const addresses = extractSolanaAddresses('No solana addresses here')
    expect(addresses).toEqual([])
  })

  it('should not extract Ethereum addresses as Solana addresses', () => {
    const addresses = extractSolanaAddresses(
      'Ethereum: 0x87cd6ec2c0a14af16574e13e1a7be486cd6cd8f4, Solana: gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu'
    )
    expect(addresses).toEqual(['gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu'])
  })

  it('should extract multiple Solana addresses', () => {
    const addresses = extractSolanaAddresses(
      'Address1: gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu, Address2: 7LendtZ5hYF1iQJLAa7Yyu2BnrnvP5LH4MLqWP6CYX5'
    )
    expect(addresses).toEqual([
      'gofofu63fevhydjbyzxgyse6dwqlazyrevjrfywkgjnu',
      '7LendtZ5hYF1iQJLAa7Yyu2BnrnvP5LH4MLqWP6CYX5'
    ])
  })
})

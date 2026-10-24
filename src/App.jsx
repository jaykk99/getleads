import React, { useState, useEffect, useMemo } from 'react';
import {
  dedupeLeads,
  dedupeLeadsFuzzy,
  validateWizardForm,
  classifyGeminiError,
  buildProspectingKit,
  csvCell,
  parseCSV,
  importLeadsFromCSV,
  scoreLeadCompleteness,
  campaignDataQuality,
  findCrossCampaignDuplicates,
} from './lib/leads.js';
import {
  scoreLeadWarmth,
  warmthTier,
  campaignWarmthDistribution,
  rankLeadsByWarmth,
} from './lib/scoring.js';
import {
  createFollowUp,
  completeFollowUp,
  reopenFollowUp,
  skipFollowUp,
  allFollowUps,
  nextDueForLead,
  followUpStats,
  suggestedFollowUpsForLead,
} from './lib/tasks.js';
import {
  DRAFT_ONLY,
  listSequenceTemplates,
  renderSequence,
  sequenceReadiness,
} from './lib/sequences.js';
import {
  createBlacklistEntry,
  upsertBlacklistEntry,
  removeBlacklistEntry,
  checkImportAgainstBlacklist,
  checkLeadBlacklist,
} from './lib/blacklist.js';
import {
  attributeSource,
  leadSource,
  normalizeLeadSource,
  sourceBreakdown,
} from './lib/attribution.js';
import {
  campaignPerformance,
  compareCampaigns,
  pipelineFunnel,
  warmthHistogram,
} from './lib/reporting.js';
import {
  normalizeTag,
  addTagsToLead,
  removeTagsFromLead,
  bulkAddTags,
  bulkRemoveTags,
  allTags,
} from './lib/tags.js';
import { 
  Briefcase, 
  Globe, 
  Search, 
  Users, 
  Mail, 
  ArrowRight, 
  Sparkles, 
  CheckCircle, 
  AlertCircle, 
  FileText, 
  ChevronRight, 
  Download, 
  ExternalLink, 
  Copy, 
  Layers, 
  MapPin, 
  TrendingUp, 
  User, 
  Send, 
  Plus, 
  Trash2, 
  Info,
  RefreshCw,
  Zap,
  Coins,
  ShieldCheck,
  Clock,
  UserCheck,
  Settings,
  X,
  Scale,
  ShieldAlert,
  Lock,
  Unlock,
  Key,
  Menu,
  BookmarkPlus,
  Filter,
  History,
  Flame,
  CalendarClock,
  Ban,
  BarChart3,
  Tag,
  ListChecks,
  MailWarning,
  ClipboardList,
  PhoneCall
} from 'lucide-react';

// Gemini calls go through /api/gemini (a serverless function holding the
// real key server-side) instead of calling Google directly from the
// browser -- see api/gemini.js. hasGeminiKey used to be a build-time
// constant read from import.meta.env.VITE_GEMINI_API_KEY, but any
// VITE_-prefixed var gets inlined into the public JS bundle, so that key
// was extractable by anyone who opened dev tools. Whether a key is
// configured is now discovered at runtime via a status check against the
// proxy (see the useEffect below), which only ever answers true/false,
// never the key itself. Optional/keyless-first stays the same: without a
// key, live AI lead generation is disabled with a clear on-screen message,
// while the Sample Campaign, campaign manager, CSV export, payment flow,
// and session recovery keep working.

// Merchant wallet address where users send their SOL payments
const MERCHANT_SOL_ADDRESS = "GvD3Z9A4p91L3P7wR4p1kU86X91Z8qVbL6p7qWeR8tY"; 

export default function App() {
  // Campaign & UI States
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaignId, setActiveCampaignId] = useState(null);
  const [viewMode, setViewMode] = useState('welcome'); // welcome, wizard, payment, dashboard
  const [loading, setLoading] = useState(false);
  // Discovered at runtime from /api/gemini's GET status check (true/false
  // only, never the key) instead of a build-time env var -- see the note
  // near the top of this file on why.
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  useEffect(() => {
    fetch('/api/gemini')
      .then(r => r.json())
      .then(d => setHasGeminiKey(!!(d && d.hasKey)))
      .catch(() => setHasGeminiKey(false));
  }, []);
  const [loadingStep, setLoadingStep] = useState(0);
  const [apiError, setApiError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [outreachType, setOutreachType] = useState('email_warm');
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Saved searches, wizard validation, dashboard filtering
  const [savedSearches, setSavedSearches] = useState([]);
  const [formErrors, setFormErrors] = useState({});
  const [searchName, setSearchName] = useState('');
  const [leadFilter, setLeadFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('warmth');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // CSV import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importing, setImporting] = useState(false);

  // Batch lead selection (dashboard)
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [batchStatus, setBatchStatus] = useState('');

  // --- Feature-engine workspace state (wires src/lib engines into the UI) ---
  // Dashboard section tabs: leads table, follow-up task board, campaign
  // reports, blacklist (do-not-contact) manager.
  const [dashTab, setDashTab] = useState('leads'); // leads | followups | reports | blacklist
  // Lead detail panel tabs inside the right-hand Contact Center column.
  const [leadPanelTab, setLeadPanelTab] = useState('profile'); // profile | warmth | followups | sequences
  // Follow-up task draft for the currently selected lead.
  const [taskDraft, setTaskDraft] = useState({ title: '', dueDate: '', priority: 'normal', notes: '' });
  const [taskFormError, setTaskFormError] = useState('');
  // Email sequence template key for the sequence preview (drafts only).
  const [seqTemplateKey, setSeqTemplateKey] = useState('email_warm');
  // Per-lead tag editor input.
  const [tagInput, setTagInput] = useState('');
  // Batch-bar tag input (bulk add/remove across selected leads).
  const [batchTagInput, setBatchTagInput] = useState('');
  // Blacklist / do-not-contact entries, persisted in localStorage.
  const [blacklist, setBlacklist] = useState([]);
  const [blDraft, setBlDraft] = useState({ type: 'domain', value: '', reason: '' });
  const [blFormError, setBlFormError] = useState('');
  const [blQuery, setBlQuery] = useState('');
  // Which campaign's report is open in the reports tab.
  const [reportCampaignId, setReportCampaignId] = useState(null);

  // Cross-campaign duplicate scan report
  const [showDupesModal, setShowDupesModal] = useState(false);
  const [dupeReport, setDupeReport] = useState(null);

  const handleScanDuplicates = () => {
    setDupeReport(findCrossCampaignDuplicates(campaigns));
    setShowDupesModal(true);
  };
  
  // Anti-Abuse and Claim Tracking States
  const [sessionToken, setSessionToken] = useState('');
  const [claimedSignatures, setClaimedSignatures] = useState({}); // Mapping of signature -> sessionToken

  // Legal Document Modals
  const [activeLegalModal, setActiveLegalModal] = useState(null); 

  // User Profile Account States (used for personalized signatures & Web3 gating)
  const [userProfile, setUserProfile] = useState({
    senderName: 'John Doe',
    senderCompany: 'My Growth Agency',
    userWalletAddress: ''
  });

  // Crypto / Payment States
  const [solPriceUSD, setSolPriceUSD] = useState(148.50); 
  const [selectedLeadTier, setSelectedLeadTier] = useState('15'); 
  const [paymentSignature, setPaymentSignature] = useState('');
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [paymentStatusMessage, setPaymentStatusMessage] = useState('');

  // Settle Recovery Tool States
  const [recoveryWallet, setRecoveryWallet] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [recovering, setRecovering] = useState(false);

  // Form Inputs for Campaign
  const [formData, setFormData] = useState({
    businessName: '',
    website: '',
    description: '',
    targetIndustry: '',
    targetLocation: '',
    targetRole: 'Owner / Marketing Director / Decision Maker',
  });

  // Calculate costs
  const getTierPriceUSD = (tier) => {
    switch (tier) {
      case '15': return 1.00;
      case '150': return 10.00;
      case '1500': return 100.00;
      case '10000': return 660.00;
      default: return 1.00;
    }
  };

  const requiredSOL = (getTierPriceUSD(selectedLeadTier) / solPriceUSD).toFixed(5);

  // Initialize Session Token (helps bind payments uniquely to this browser session)
  useEffect(() => {
    let currentSession = localStorage.getItem('get_leads_session_token');
    if (!currentSession) {
      currentSession = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('get_leads_session_token', currentSession);
    }
    setSessionToken(currentSession);

    // Initialize global claimed signatures registry locally (simulating a global anti-abuse ledger)
    const savedRegistry = localStorage.getItem('get_leads_claimed_registry');
    if (savedRegistry) {
      try {
        setClaimedSignatures(JSON.parse(savedRegistry));
      } catch (e) {
        console.error("Failed to load claims registry", e);
      }
    }
  }, []);

  // Save Claim to Registry
  const recordSignatureClaim = (signature, session) => {
    const updated = { ...claimedSignatures, [signature]: session };
    setClaimedSignatures(updated);
    localStorage.setItem('get_leads_claimed_registry', JSON.stringify(updated));
  };

  // Fetch live SOL price on mount
  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
      .then(res => res.json())
      .then(data => {
        if (data?.solana?.usd) {
          setSolPriceUSD(data.solana.usd);
        }
      })
      .catch(err => console.warn("Failed to fetch live SOL price, using fallback.", err));
  }, []);

  // Load campaigns & Profile from Local Storage on mount
  useEffect(() => {
    const savedCampaigns = localStorage.getItem('get_leads_campaigns');
    if (savedCampaigns) {
      try {
        const parsed = JSON.parse(savedCampaigns);
        if (parsed && parsed.length > 0) {
          setCampaigns(parsed);
          setActiveCampaignId(parsed[0].id);
          setViewMode('dashboard');
        }
      } catch (e) {
        console.error("Failed to load saved campaigns", e);
      }
    }

    const savedProfile = localStorage.getItem('get_leads_user_profile');
    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile);
        if (parsed) {
          setUserProfile(parsed);
        }
      } catch (e) {
        console.error("Failed to load user profile", e);
      }
    }

    // Load saved searches (wizard presets)
    const savedSearchesRaw = localStorage.getItem('get_leads_saved_searches');
    if (savedSearchesRaw) {
      try {
        const parsed = JSON.parse(savedSearchesRaw);
        if (Array.isArray(parsed)) setSavedSearches(parsed);
      } catch (e) {
        console.error("Failed to load saved searches", e);
      }
    }

    // Load blacklist / do-not-contact entries
    const blRaw = localStorage.getItem('get_leads_blacklist');
    if (blRaw) {
      try {
        const parsed = JSON.parse(blRaw);
        if (Array.isArray(parsed)) setBlacklist(parsed);
      } catch (e) {
        console.error("Failed to load blacklist", e);
      }
    }
  }, []);

  // Save campaigns to local storage
  const saveCampaigns = (newCampaigns) => {
    setCampaigns(newCampaigns);
    localStorage.setItem('get_leads_campaigns', JSON.stringify(newCampaigns));
  };

  // Save profile to local storage
  const saveProfile = (updatedProfile) => {
    setUserProfile(updatedProfile);
    localStorage.setItem('get_leads_user_profile', JSON.stringify(updatedProfile));
  };

  // Saved searches: reusable wizard presets (name + form parameters)
  const persistSavedSearches = (list) => {
    setSavedSearches(list);
    localStorage.setItem('get_leads_saved_searches', JSON.stringify(list));
  };

  const handleSaveSearch = () => {
    const name = (searchName || '').trim()
      || `${(formData.targetIndustry || 'Search').trim()} — ${(formData.targetLocation || 'anywhere').trim()}`;
    const entry = {
      id: 'search_' + Date.now(),
      name: name.slice(0, 80),
      createdAt: new Date().toLocaleDateString(),
      params: { ...formData },
    };
    persistSavedSearches([entry, ...savedSearches].slice(0, 25));
    setSearchName('');
  };

  const handleLoadSearch = (entry) => {
    setFormData({ ...entry.params });
    setSearchName(entry.name);
    setFormErrors({});
  };

  const handleDeleteSearch = (id, e) => {
    if (e) e.stopPropagation();
    persistSavedSearches(savedSearches.filter((s) => s.id !== id));
  };

  // Keyless manual prospecting kit: a CSV of ready-made Google search queries
  // built from the campaign form. Works fully offline of any API key.
  const handleDownloadProspectingKit = () => {
    const rows = buildProspectingKit(formData);
    const lines = [['Purpose', 'Google Search Query', 'Direct Link'].map(csvCell).join(',')];
    rows.forEach((r) => {
      lines.push([r.purpose, r.query, r.url].map(csvCell).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (formData.targetIndustry || 'leads').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    a.download = `prospecting_kit_${slug || 'leads'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // Helper function for exponential backoff API calls
  async function callGeminiWithRetry(payload, retries = 5, delay = 1000) {
    const url = '/api/gemini';
    
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          return await response.json();
        }
        
        if (response.status === 429) {
          await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
          continue;
        }
        
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText}`);
      } catch (error) {
        // Client errors (bad key, bad request, forbidden) and the proxy's
        // "no server key configured" (503) will never succeed on retry —
        // fail fast so the user gets the real message immediately.
        if (/API error \((400|401|403|503)\)/.test(error.message)) throw error;
        if (i === retries - 1) throw error;
        await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
      }
    }
  }

  // Verify Solana Payment with Strict Abuse / Multi-Session check
  const handleVerifyPayment = async () => {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(userProfile.userWalletAddress.trim())) {
      setPaymentStatusMessage("Please enter your Solana wallet address in your profile first — it's used to verify the payment came from you.");
      return;
    }

    if (!paymentSignature) {
      setPaymentStatusMessage("Please fill in your Transaction Signature to scan.");
      return;
    }

    const cleanSignature = paymentSignature.trim();

    // Basic format check: Solana tx signatures are base58, 87-88 chars.
    // Catches pasted wallet addresses / truncated hashes before hitting the RPC.
    if (!/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(cleanSignature)) {
      setPaymentStatusMessage("That doesn't look like a Solana transaction signature (base58, 87–88 characters). Copy the full signature from your wallet or Solana Explorer and try again.");
      return;
    }

    // ANTI-ABUSE GUARD: Check if signature has already been claimed by another session
    if (claimedSignatures[cleanSignature] && claimedSignatures[cleanSignature] !== sessionToken) {
      setPaymentStatusMessage("❌ Security Alert: This transaction signature has already been claimed by another active workspace. You cannot reuse signatures across multiple sessions.");
      return;
    }

    setVerifyingPayment(true);
    setPaymentStatusMessage("Querying Solana Mainnet Ledger & validating session lease...");

    try {
      const rpcUrl = "https://api.mainnet-beta.solana.com";
      const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          cleanSignature,
          { encoding: "json", maxSupportedTransactionVersion: 0 }
        ]
      };

      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error.message || "Failed to fetch transaction details.");
      }

      const tx = result.result;
      if (!tx) {
        throw new Error("Transaction signature not yet logged on-chain. Please wait for confirmation.");
      }

      const accountKeys = tx.transaction.message.accountKeys;
      const normalizedUserWallet = userProfile.userWalletAddress.trim();
      const normalizedMerchantWallet = MERCHANT_SOL_ADDRESS.trim();

      // Check if the sender is indeed the user's saved account wallet address
      const sender = accountKeys[0]; 
      if (sender.toLowerCase() !== normalizedUserWallet.toLowerCase()) {
        throw new Error(`This transaction sender address (${sender}) does not match your account profile address (${normalizedUserWallet}).`);
      }

      const meta = tx.meta;
      const preBalances = meta.preBalances;
      const postBalances = meta.postBalances;
      
      const merchantIndex = accountKeys.indexOf(normalizedMerchantWallet);

      if (merchantIndex === -1) {
        throw new Error(`The transaction does not transfer SOL to the merchant address: ${MERCHANT_SOL_ADDRESS}`);
      }

      const lamportsReceived = postBalances[merchantIndex] - preBalances[merchantIndex];
      const solReceived = lamportsReceived / 1_000_000_000;

      const expectedSOL = parseFloat(requiredSOL);
      const tolerance = 0.002; 

      if (solReceived < (expectedSOL - tolerance)) {
        throw new Error(`Insufficient SOL transferred. Found: ${solReceived.toFixed(5)} SOL, Expected: ${expectedSOL} SOL.`);
      }

      // Record transaction claim to prevent session double-spend/abuse
      recordSignatureClaim(cleanSignature, sessionToken);

      setPaymentVerified(true);
      setPaymentStatusMessage(`✅ Payment Verified & Session-Leased successfully! Sourcing leads...`);
      
      // Proceed directly to lead extraction
      setTimeout(() => {
        generateLeadsCampaign();
      }, 1500);

    } catch (err) {
      console.error(err);
      setPaymentStatusMessage(`Verification Error: ${err.message}`);
    } finally {
      setVerifyingPayment(false);
    }
  };

  // Wallet-Based Settle Scan & Autopilot Recovery Tool
  const handleAutopilotRecovery = async () => {
    if (!recoveryWallet) {
      setRecoveryStatus("Please enter your Solana Wallet address to recover campaigns.");
      return;
    }

    setRecovering(true);
    setRecoveryStatus("Searching Solana blockchain for transfer signatures associated with this wallet...");

    try {
      const targetWallet = recoveryWallet.trim();
      const rpcUrl = "https://api.mainnet-beta.solana.com";

      // Step 1: Get recent transactions for the recovery wallet
      const sigPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [
          targetWallet,
          { limit: 10 }
        ]
      };

      const sigResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sigPayload)
      });

      const sigResult = await sigResponse.json();

      if (sigResult.error) {
        throw new Error(sigResult.error.message || "Failed to retrieve address signatures.");
      }

      const transactions = sigResult.result || [];
      if (transactions.length === 0) {
        throw new Error("No recent on-chain transfers found for this address.");
      }

      // Step 2: Loop through and inspect transactions to find any that paid our merchant
      let foundUnclaimedValidTx = null;
      let targetTierFound = '15';

      for (let txInfo of transactions) {
        const checkPayload = {
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [
            txInfo.signature,
            { encoding: "json", maxSupportedTransactionVersion: 0 }
          ]
        };

        const txResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(checkPayload)
        });

        const txResult = await txResponse.json();
        const tx = txResult.result;

        if (tx) {
          const accountKeys = tx.transaction.message.accountKeys;
          const merchantIdx = accountKeys.indexOf(MERCHANT_SOL_ADDRESS);

          if (merchantIdx !== -1) {
            // Check if this signature has already been locked/claimed in this or another session
            const cleanSig = txInfo.signature.trim();
            if (claimedSignatures[cleanSig] && claimedSignatures[cleanSig] !== sessionToken) {
              continue; // Skip claimed transactions (prevents session sharing)
            }

            // Calculate transferred SOL
            const lamports = tx.meta.postBalances[merchantIdx] - tx.meta.preBalances[merchantIdx];
            const solTransferred = lamports / 1_000_000_000;

            // Match amount to a tier
            if (solTransferred > 0.005) { // Valid non-trivial transfer
              foundUnclaimedValidTx = cleanSig;
              // Set tier accordingly based on approximate pricing values
              if (solTransferred > 1.5) targetTierFound = '10000';
              else if (solTransferred > 0.4) targetTierFound = '1500';
              else if (solTransferred > 0.04) targetTierFound = '150';
              else targetTierFound = '15';
              break;
            }
          }
        }
      }

      if (!foundUnclaimedValidTx) {
        throw new Error("No unclaimed, paid transactions to our merchant address were found for this wallet.");
      }

      // Match found unclaimed transaction
      setUserProfile({
        ...userProfile,
        userWalletAddress: targetWallet
      });
      setSelectedLeadTier(targetTierFound);
      setPaymentSignature(foundUnclaimedValidTx);
      recordSignatureClaim(foundUnclaimedValidTx, sessionToken);

      setRecoveryStatus(`✅ Unclaimed transaction verified! Bound signature ${foundUnclaimedValidTx.substring(0, 10)}... to your session. Sourcing leads list now.`);
      
      // Auto-trigger generation
      setTimeout(() => {
        generateLeadsCampaign();
      }, 1500);

    } catch (err) {
      console.error(err);
      setRecoveryStatus(`Recovery Failed: ${err.message}`);
    } finally {
      setRecovering(false);
    }
  };

  // Run lead generation with real search grounding
  const generateLeadsCampaign = async () => {
    // Keyless-first: refuse early with a clear message instead of a cryptic
    // API 400 from the backend. Everything else in the app works without a key.
    if (!hasGeminiKey) {
      setApiError(
        "Live lead generation needs a Gemini API key. Add VITE_GEMINI_API_KEY to your .env file " +
        "(see .env.example), rebuild, and redeploy — or load the free Sample Campaign from the sidebar " +
        "to explore the full dashboard without a key."
      );
      return;
    }
    setLoading(true);
    setApiError(null);
    setLoadingStep(1); 

    try {
      // Step 1: Analyze target company parameters
      // Keep the analysis tight and factual: prefer the provided website via
      // search grounding, fall back to the description, never invent details.
      const analysisPrompt = `
        You are an elite B2B growth agency system.
        Analyze the following business and return ONLY verified or clearly-labeled facts.
        - Business Name: ${formData.businessName || userProfile.senderCompany}
        - Website: ${formData.website || 'None provided'}
        - Description: ${formData.description || 'None provided'}

        ${formData.website ? `Use google_search to look up "${formData.businessName || userProfile.senderCompany} ${formData.website}" and base your analysis on what you actually find.` : `No website was provided. Work only from the description above; if the description is empty, say so plainly instead of inventing one.`}

        Return a structured JSON with these exact keys:
        {
          "companyDescription": "One clear sentence about what the company does (mark as 'Not specified' if unknown)",
          "coreOffer": "The primary product/service they sell, as stated or clearly inferred",
          "valueProposition": "Why customers choose them, in one sentence",
          "suggestedTargetSectors": ["Sector 1", "Sector 2", "Sector 3"]
        }
        The suggestedTargetSectors must be real industries that plausibly buy the core offer.
      `;

      let businessAnalysis = {
        companyDescription: formData.description || `Service provider in ${formData.targetIndustry || 'their industry'}.`,
        coreOffer: "Standard Services",
        valueProposition: "High quality custom solutions",
        suggestedTargetSectors: [formData.targetIndustry || "Local Businesses"]
      };

      try {
        const analysisPayload = {
          contents: [{ parts: [{ text: analysisPrompt }] }],
          tools: [{ "googleSearch": {} }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                companyDescription: { type: "STRING" },
                coreOffer: { type: "STRING" },
                valueProposition: { type: "STRING" },
                suggestedTargetSectors: { type: "ARRAY", items: { type: "STRING" } }
              },
              required: ["companyDescription", "coreOffer", "valueProposition", "suggestedTargetSectors"]
            }
          }
        };

        const analysisResponse = await callGeminiWithRetry(analysisPayload);
        const analysisText = analysisResponse.candidates?.[0]?.content?.parts?.[0]?.text;
        if (analysisText) {
          businessAnalysis = JSON.parse(analysisText);
        }
      } catch (err) {
        console.warn("Could not perform full business lookup, falling back to form data:", err);
      }

      setLoadingStep(2); 

      // Step 2: Search Grounding to find real-world leads
      const searchNiche = formData.targetIndustry || businessAnalysis.suggestedTargetSectors[0];
      const searchLoc = formData.targetLocation || "United States";
      const leadQty = parseInt(selectedLeadTier) || 15;

      const leadSearchPrompt = `
        You are an elite B2B pipeline builder working ONLY from live Google search results.
        Build a prospect list for our company: "${formData.businessName || userProfile.senderCompany}".
        Our business profile:
        - Description: ${businessAnalysis.companyDescription}
        - Core Offer: ${businessAnalysis.coreOffer}
        - Value Proposition: ${businessAnalysis.valueProposition}

        Using google_search grounding, find real, currently-active businesses in "${searchNiche}" operating in "${searchLoc}" that would plausibly benefit from our core offer.

        STRICT RULES:
        - NEVER invent a company, person, email, or phone number. Every row must come from an actual search result.
        - If you cannot verify ${leadQty} distinct real companies, return FEWER rows — a short honest list beats a padded fake one.
        - Each company may appear only once (no duplicate companies or duplicate domains).
        - The website field must be the company's real domain, matching the company name (e.g. company "Acme Dental" -> website on acmedental.com).
        - Contact emails must be real patterns you found or clearly-standard formats like info@domain.com / contact@domain.com; never invent a personal name + invented inbox and present it as verified.
        - Phone numbers: only include if found in the source; otherwise use "".
        - warmthScore (1-100): score ONLY on observable fit between the prospect's public profile and our core offer; 85+ means obvious current need, 60-84 moderate fit, below 60 weak fit. Explain the score in leadReason.
        - sourcedFromUrl must be the actual search-result URL where the business was verified.

        For each verified lead provide:
        1. Company Name
        2. Website (real active URL)
        3. Target Decision Maker Name (publicly-listed founder/executive only; use "" if none is publicly listed)
        4. Target Decision Maker Title
        5. Contact Email
        6. Phone number ("" if not found)
        7. Warmth Score (1-100, per the rules above)
        8. Lead Reason (why THIS company needs our core offer now, referencing something real you found)
        9. Custom Outreach Hook (hyper-personalized icebreaker referencing their niche or a real public fact)
        10. SourcedFromUrl (the verifying search-result URL)

        Return a structured JSON with this exact key: "leads" which contains an array of lead objects.
      `;

      const leadPayload = {
        contents: [{ parts: [{ text: leadSearchPrompt }] }],
        tools: [{ "googleSearch": {} }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              leads: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    companyName: { type: "STRING" },
                    website: { type: "STRING" },
                    contactName: { type: "STRING" },
                    contactTitle: { type: "STRING" },
                    email: { type: "STRING" },
                    phone: { type: "STRING" },
                    warmthScore: { type: "NUMBER" },
                    leadReason: { type: "STRING" },
                    customHook: { type: "STRING" },
                    sourcedFromUrl: { type: "STRING" }
                  },
                  required: ["companyName", "website", "contactName", "contactTitle", "email", "phone", "warmthScore", "leadReason", "customHook", "sourcedFromUrl"]
                }
              }
            },
            required: ["leads"]
          }
        }
      };

      const leadResponse = await callGeminiWithRetry(leadPayload);
      const leadText = leadResponse.candidates?.[0]?.content?.parts?.[0]?.text;
      
      const groundingAttributions = leadResponse.candidates?.[0]?.groundingMetadata?.groundingAttributions?.map(a => ({
        uri: a.web?.uri,
        title: a.web?.title
      })) || [];

      let leadsList = [];
      if (leadText) {
        const parsedLeads = JSON.parse(leadText);
        leadsList = parsedLeads.leads || [];
      } else {
        throw new Error("No leads returned from the generator API.");
      }

      // Sanitize + deduplicate: drop empty rows, normalize fields, clamp
      // scores, and remove duplicate companies/domains before saving.
      const sanitized = leadsList
        .filter((l) => l && (l.companyName || '').trim())
        .map((l) => ({
          ...l,
          companyName: (l.companyName || '').trim(),
          website: (l.website || '').trim(),
          contactName: (l.contactName || '').trim(),
          contactTitle: (l.contactTitle || '').trim(),
          email: (l.email || '').trim(),
          phone: (l.phone || '').trim(),
          warmthScore: Math.max(1, Math.min(100, Math.round(Number(l.warmthScore) || 50))),
          leadReason: (l.leadReason || '').trim(),
          customHook: (l.customHook || '').trim(),
          sourcedFromUrl: (l.sourcedFromUrl || '').trim(),
        }));
      const { leads: uniqueLeads, removed } = dedupeLeadsFuzzy(sanitized);
      if (removed > 0) {
        console.info(`[getleads] Removed ${removed} duplicate lead row(s) before saving.`);
      }
      leadsList = uniqueLeads;

      if (leadsList.length === 0) {
        throw new Error("No leads returned from the generator API.");
      }

      setLoadingStep(3); 

      // Generate outreach templates using user's personalized profile settings
      const outreachPrompt = `
        Draft three premium outbound communication templates written from the perspective of:
        - Sender Name: ${userProfile.senderName}
        - Sender Company: ${userProfile.senderCompany}
        - Core Offer: ${businessAnalysis.coreOffer}
        - Prospect Target Industry: ${searchNiche}
        
        Generate:
        1. A high-converting "warm_email" template using a value-first, low-friction reply hook.
        2. A direct "cold_call" script with objection-handling and clear opening hook.
        3. A premium "linkedin_message" (under 300 characters) that builds instant rapport.

        Use placeholders like {{ContactName}}, {{CompanyName}}, and {{CustomHook}} in the templates. Make sure to sign off using "${userProfile.senderName} from ${userProfile.senderCompany}".
        
        Return a structured JSON with these keys:
        {
          "warmEmail": "The full body of the email",
          "coldCallScript": "The script with conversational cues",
          "linkedinMessage": "The short LinkedIn connect note"
        }
      `;

      const outreachPayload = {
        contents: [{ parts: [{ text: outreachPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              warmEmail: { type: "STRING" },
              coldCallScript: { type: "STRING" },
              linkedinMessage: { type: "STRING" }
            },
            required: ["warmEmail", "coldCallScript", "linkedinMessage"]
          }
        }
      };

      const outreachResponse = await callGeminiWithRetry(outreachPayload);
      const outreachText = outreachResponse.candidates?.[0]?.content?.parts?.[0]?.text;
      let outreachTemplates = {
        warmEmail: `Hi {{ContactName}},\n\nI noticed {{CompanyName}} is doing great work. {{CustomHook}}\n\nWe specialize in ${businessAnalysis.coreOffer}. Would you be open to a quick chat?\n\nBest,\n${userProfile.senderName}\n${userProfile.senderCompany}`,
        coldCallScript: `Hey {{ContactName}}, this is ${userProfile.senderName} from ${userProfile.senderCompany}. I saw {{CompanyName}}'s profile online. {{CustomHook}} Is this a bad time for a quick question?`,
        linkedinMessage: `Hi {{ContactName}}, loved your latest work at {{CompanyName}}. {{CustomHook}} Let's connect! - ${userProfile.senderName}`
      };

      if (outreachText) {
        const parsedOutreach = JSON.parse(outreachText);
        outreachTemplates = {
          warmEmail: parsedOutreach.warmEmail,
          coldCallScript: parsedOutreach.coldCallScript,
          linkedinMessage: parsedOutreach.linkedinMessage
        };
      }

      // Consolidate Campaign data
      const newCampaign = {
        id: 'camp_' + Date.now(),
        date: new Date().toLocaleDateString(),
        businessInfo: {
          name: formData.businessName || userProfile.senderCompany,
          website: formData.website,
          description: businessAnalysis.companyDescription,
          coreOffer: businessAnalysis.coreOffer,
          valueProposition: businessAnalysis.valueProposition,
          targetIndustry: searchNiche,
          targetLocation: searchLoc,
          targetRole: formData.targetRole
        },
        leads: leadsList.map((l, index) => ({
          ...l,
          id: `lead_${Date.now()}_${index}`,
          status: 'New',
          notes: ''
        })),
        groundingAttributions,
        outreachTemplates
      };

      const updatedCampaigns = [newCampaign, ...campaigns];
      saveCampaigns(updatedCampaigns);
      setActiveCampaignId(newCampaign.id);
      setSelectedLead(newCampaign.leads[0] || null);
      setViewMode('dashboard');

      // Clear payment states
      setPaymentVerified(false);
      setPaymentSignature('');

    } catch (error) {
      console.error(error);
      setApiError(classifyGeminiError(error.message));
    } finally {
      setLoading(false);
      setLoadingStep(0);
    }
  };

  // Switch Campaigns
  const handleSelectCampaign = (id) => {
    setActiveCampaignId(id);
    setSidebarOpen(false); // collapse mobile campaigns drawer
    const camp = campaigns.find(c => c.id === id);
    if (camp && camp.leads.length > 0) {
      setSelectedLead(camp.leads[0]);
    } else {
      setSelectedLead(null);
    }
  };

  // Delete Campaign
  const handleDeleteCampaign = (id, e) => {
    e.stopPropagation();
    const updated = campaigns.filter(c => c.id !== id);
    saveCampaigns(updated);
    if (activeCampaignId === id) {
      if (updated.length > 0) {
        setActiveCampaignId(updated[0].id);
        setSelectedLead(updated[0].leads[0] || null);
      } else {
        setActiveCampaignId(null);
        setSelectedLead(null);
        setViewMode('welcome');
      }
    }
  };

  // Update single Lead status or notes
  const handleUpdateLead = (leadId, updates) => {
    const updatedCampaigns = campaigns.map(camp => {
      if (camp.id === activeCampaignId) {
        const updatedLeads = camp.leads.map(lead => {
          if (lead.id === leadId) {
            const updated = { ...lead, ...updates };
            if (selectedLead && selectedLead.id === leadId) {
              setSelectedLead(updated);
            }
            return updated;
          }
          return lead;
        });
        return { ...camp, leads: updatedLeads };
      }
      return camp;
    });
    saveCampaigns(updatedCampaigns);
  };

  const activeCampaign = campaigns.find(c => c.id === activeCampaignId);

  // Dashboard: searchable, filterable, sortable view of the active leads list
  const filteredLeads = useMemo(() => {
    if (!activeCampaign) return [];
    let list = [...activeCampaign.leads];
    if (statusFilter !== 'all') {
      list = list.filter((l) => (l.status || 'New') === statusFilter);
    }
    const q = leadFilter.trim().toLowerCase();
    if (q) {
      list = list.filter((l) =>
        [l.companyName, l.contactName, l.contactTitle, l.email, l.website]
          .some((v) => (v || '').toLowerCase().includes(q))
      );
    }
    switch (sortBy) {
      case 'company':
        list.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));
        break;
      case 'status':
        list.sort((a, b) => (a.status || '').localeCompare(b.status || ''));
        break;
      case 'quality':
        list.sort(
          (a, b) => scoreLeadCompleteness(b).score - scoreLeadCompleteness(a).score
        );
        break;
      case 'warmth':
      default:
        list.sort((a, b) => (Number(b.warmthScore) || 0) - (Number(a.warmthScore) || 0));
    }
    return list;
  }, [activeCampaign, leadFilter, statusFilter, sortBy]);

  // Copy helper — prefers the Clipboard API, falls back to the legacy
  // execCommand path on non-secure contexts. Only reports success on success.
  const handleCopyToClipboard = async (text, id) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!ok) throw new Error("execCommand copy returned false");
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  // Export Leads to CSV (Blob download — safe for large 10k-lead campaigns)
  const handleExportCSV = () => {
    if (!activeCampaign || !activeCampaign.leads.length) return;

    const headers = ["Company Name", "Website", "Decision Maker", "Title", "Email", "Phone", "Warmth Score", "Lead Match Reason", "Sourced From URL", "Status"];
    const rows = activeCampaign.leads.map(l => [
      l.companyName,
      l.website,
      l.contactName,
      l.contactTitle,
      l.email,
      l.phone,
      l.warmthScore,
      l.leadReason,
      (l.sourcedFromUrl || ''),
      l.status
    ].map(csvCell).join(","));

    const csvContent = [headers.map(csvCell).join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `get_leads_${activeCampaign.businessInfo.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'campaign'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // Clear the lead selection whenever the active campaign or filters change
  useEffect(() => {
    setSelectedLeadIds([]);
    setBatchStatus('');
  }, [activeCampaignId, leadFilter, statusFilter, sortBy]);

  const toggleLeadSelected = (id) => {
    setSelectedLeadIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectShown = () => {
    const ids = filteredLeads.map((l) => l.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedLeadIds.includes(id));
    setSelectedLeadIds(allSelected ? [] : ids);
  };

  // Apply one status to every selected lead in one go
  const handleBatchStatus = () => {
    if (!batchStatus || !selectedLeadIds.length || !activeCampaign) return;
    const updatedCampaigns = campaigns.map((camp) => {
      if (camp.id !== activeCampaignId) return camp;
      const updatedLeads = camp.leads.map((lead) =>
        selectedLeadIds.includes(lead.id) ? { ...lead, status: batchStatus } : lead
      );
      return { ...camp, leads: updatedLeads };
    });
    saveCampaigns(updatedCampaigns);
    setSelectedLeadIds([]);
    setBatchStatus('');
  };

  // Remove every selected lead (confirm first — this is destructive)
  const handleBatchDelete = () => {
    if (!selectedLeadIds.length || !activeCampaign) return;
    if (!window.confirm(`Delete ${selectedLeadIds.length} selected lead(s)? This cannot be undone.`)) return;
    const updatedCampaigns = campaigns.map((camp) => {
      if (camp.id !== activeCampaignId) return camp;
      return { ...camp, leads: camp.leads.filter((lead) => !selectedLeadIds.includes(lead.id)) };
    });
    saveCampaigns(updatedCampaigns);
    if (selectedLead && selectedLeadIds.includes(selectedLead.id)) setSelectedLead(null);
    setSelectedLeadIds([]);
  };

  // Persist the blacklist / do-not-contact list.
  const saveBlacklist = (list) => {
    setBlacklist(list);
    localStorage.setItem('get_leads_blacklist', JSON.stringify(list));
  };

  // Add a blacklist entry (domain / email / company name).
  const handleAddBlacklistEntry = () => {
    try {
      const entry = createBlacklistEntry(blDraft);
      saveBlacklist(upsertBlacklistEntry(blacklist, entry));
      setBlDraft({ type: 'domain', value: '', reason: '' });
      setBlFormError('');
    } catch (e) {
      setBlFormError(e.message || 'Invalid blacklist entry.');
    }
  };

  // Remove a blacklist entry by id.
  const handleRemoveBlacklistEntry = (id) => {
    saveBlacklist(removeBlacklistEntry(blacklist, id));
  };

  // --- Follow-up tasks (per selected lead) ---------------------------------
  // Mutates the selected lead's followUps array inside the active campaign.
  const updateLeadFollowUps = (leadId, nextFollowUps) => {
    handleUpdateLead(leadId, { followUps: nextFollowUps });
  };

  const handleAddFollowUp = () => {
    if (!selectedLead) return;
    const draft = {
      title: taskDraft.title,
      dueDate: taskDraft.dueDate || undefined,
      priority: taskDraft.priority,
      notes: taskDraft.notes,
    };
    try {
      const task = createFollowUp(selectedLead.id, draft);
      const next = [...(selectedLead.followUps || []), task];
      updateLeadFollowUps(selectedLead.id, next);
      setTaskDraft({ title: '', dueDate: '', priority: 'normal', notes: '' });
      setTaskFormError('');
    } catch (e) {
      setTaskFormError(e.message || 'Invalid task.');
    }
  };

  // One-click: attach the engine's suggested follow-up cadence to the lead.
  const handleAddSuggestedFollowUps = () => {
    if (!selectedLead) return;
    const existing = new Set((selectedLead.followUps || []).map((t) => t.title));
    const fresh = suggestedFollowUpsForLead(selectedLead)
      .filter((d) => !existing.has(d.title))
      .map((d) => createFollowUp(selectedLead.id, d));
    if (!fresh.length) return;
    updateLeadFollowUps(selectedLead.id, [...(selectedLead.followUps || []), ...fresh]);
  };

  // Toggle a task between open/done/skipped from any board surface.
  const mutateTaskInCampaigns = (leadId, taskId, mutator) => {
    const updatedCampaigns = campaigns.map((camp) => {
      const updatedLeads = camp.leads.map((lead) => {
        if (lead.id !== leadId) return lead;
        const followUps = (lead.followUps || []).map((t) =>
          t.id === taskId ? mutator(t) : t
        );
        const updated = { ...lead, followUps };
        if (selectedLead && selectedLead.id === leadId) setSelectedLead(updated);
        return updated;
      });
      return { ...camp, leads: updatedLeads };
    });
    saveCampaigns(updatedCampaigns);
  };

  const handleCompleteTask = (leadId, taskId) => mutateTaskInCampaigns(leadId, taskId, completeFollowUp);
  const handleReopenTask = (leadId, taskId) => mutateTaskInCampaigns(leadId, taskId, reopenFollowUp);
  const handleSkipTask = (leadId, taskId, reason) => mutateTaskInCampaigns(leadId, taskId, (t) => skipFollowUp(t, reason));

  // --- Tags (per lead + bulk) ------------------------------------------------
  const handleAddLeadTag = () => {
    if (!selectedLead || !tagInput.trim()) return;
    const updated = addTagsToLead(selectedLead, [tagInput]);
    if (JSON.stringify(updated.tags) !== JSON.stringify(selectedLead.tags)) {
      handleUpdateLead(selectedLead.id, { tags: updated.tags });
    }
    setTagInput('');
  };

  const handleRemoveLeadTag = (tag) => {
    if (!selectedLead) return;
    const updated = removeTagsFromLead(selectedLead, [tag]);
    handleUpdateLead(selectedLead.id, { tags: updated.tags });
  };

  const handleBulkAddTags = () => {
    if (!batchTagInput.trim() || !selectedLeadIds.length || !activeCampaign) return;
    const updatedCampaigns = campaigns.map((camp) => {
      if (camp.id !== activeCampaignId) return camp;
      const { leads } = bulkAddTags(camp.leads, selectedLeadIds, [batchTagInput]);
      return { ...camp, leads };
    });
    saveCampaigns(updatedCampaigns);
    setBatchTagInput('');
  };

  const handleBulkRemoveTags = () => {
    if (!batchTagInput.trim() || !selectedLeadIds.length || !activeCampaign) return;
    const updatedCampaigns = campaigns.map((camp) => {
      if (camp.id !== activeCampaignId) return camp;
      const { leads } = bulkRemoveTags(camp.leads, selectedLeadIds, [batchTagInput]);
      return { ...camp, leads };
    });
    saveCampaigns(updatedCampaigns);
    setBatchTagInput('');
  };

  // Derived dashboard data (memoized per campaign).
  const followUpsBoard = useMemo(
    () => (activeCampaign ? allFollowUps(activeCampaign) : []),
    [activeCampaign]
  );
  const campaignStats = useMemo(
    () => (activeCampaign ? followUpStats(activeCampaign) : null),
    [activeCampaign]
  );
  const reportData = useMemo(() => {
    const c = campaigns.find((x) => x.id === (reportCampaignId || activeCampaignId));
    return c ? campaignPerformance(c) : null;
  }, [campaigns, reportCampaignId, activeCampaignId]);
  const campaignCompareRows = useMemo(
    () => compareCampaigns(campaigns),
    [campaigns]
  );

  /* ---------------- CSV import (bring your own list) ---------------- */

  // Analyze pasted/uploaded CSV and show a preview before anything is saved
  const handleImportPreview = (text) => {
    const t = (text || '').trim();
    if (!t) {
      setImportPreview({ leads: [], parsed: 0, dropped: 0, removedDuplicates: 0, errors: ["Paste CSV text or choose a file first."] });
      return;
    }
    const preview = importLeadsFromCSV(t);
    // Do-not-contact gate: leads matching the blacklist never reach the campaign.
    const { allowed, blockedCount, notes } = checkImportAgainstBlacklist(preview.leads, blacklist);
    setImportPreview({ ...preview, leads: allowed, blockedCount, blockedNotes: notes });
  };

  const handleImportFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target.result || '');
      setImportText(text);
      handleImportPreview(text);
    };
    reader.readAsText(file);
  };

  // Save the previewed import as a new campaign
  const handleConfirmImport = () => {
    if (!importPreview || !importPreview.leads.length || importing) return;
    setImporting(true);
    const leads = importPreview.leads.map((l, index) => ({
      ...normalizeLeadSource(l),
      id: `lead_csv_${Date.now()}_${index}`,
      notes: l.notes || '',
    }));
    const campaign = {
      id: 'camp_csv_' + Date.now(),
      date: new Date().toLocaleDateString(),
      businessInfo: {
        name: 'CSV Import',
        website: '',
        description: 'Imported from CSV',
        coreOffer: '',
        valueProposition: '',
        targetIndustry: '',
        targetLocation: '',
        targetRole: '',
      },
      leads,
      groundingAttributions: [],
      outreachTemplates: {
        warmEmail: `Hi {{ContactName}},\n\nI noticed {{CompanyName}} and wanted to reach out. {{CustomHook}}\n\nBest,\n${userProfile.senderName}\n${userProfile.senderCompany}`,
        coldCallScript: `Hi {{ContactName}}, it's ${userProfile.senderName} from ${userProfile.senderCompany}. Quick question about {{CompanyName}}...`,
        linkedinMessage: `Hi {{ContactName}}, loved what you're doing at {{CompanyName}}. Let's connect! - ${userProfile.senderName}`,
      },
    };
    const updated = [campaign, ...campaigns];
    saveCampaigns(updated);
    setActiveCampaignId(campaign.id);
    setSelectedLead(leads[0] || null);
    setImporting(false);
    setShowImportModal(false);
    setImportText('');
    setImportPreview(null);
    setViewMode('dashboard');
  };

  // Merge the previewed import into the currently open campaign instead
  const handleMergeImport = () => {
    if (!importPreview || !importPreview.leads.length || importing || !activeCampaign) return;
    setImporting(true);
    const fresh = importPreview.leads.map((l, index) => ({
      ...normalizeLeadSource(l),
      id: `lead_csv_${Date.now()}_${index}`,
      notes: l.notes || '',
    }));
    const { leads: merged, removed } = dedupeLeadsFuzzy([...activeCampaign.leads, ...fresh]);
    const updatedCampaigns = campaigns.map((camp) =>
      camp.id === activeCampaignId ? { ...camp, leads: merged } : camp
    );
    saveCampaigns(updatedCampaigns);
    setImporting(false);
    setShowImportModal(false);
    setImportText('');
    setImportPreview(null);
    setViewMode('dashboard');
    if (removed) {
      alert(`Merged ${fresh.length - removed} new lead(s) into "${activeCampaign.businessInfo.name}". ${removed} duplicate(s) skipped.`);
    }
  };

  // Export only the selected leads (batch toolbar) to CSV
  const handleExportSelectedCSV = () => {
    const rows = (activeCampaign?.leads || []).filter((l) => selectedLeadIds.includes(l.id));
    if (!rows.length) return;
    const headers = ["Company Name", "Website", "Decision Maker", "Title", "Email", "Phone", "Warmth Score", "Lead Match Reason", "Sourced From URL", "Status"];
    const body = rows.map((l) => [
      l.companyName, l.website, l.contactName, l.contactTitle, l.email, l.phone,
      l.warmthScore, l.leadReason, (l.sourcedFromUrl || ''), l.status
    ].map(csvCell).join(","));
    const csvContent = [headers.map(csvCell).join(","), ...body].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `get_leads_selected_${rows.length}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const openImportModal = () => {
    setImportText('');
    setImportPreview(null);
    setShowImportModal(true);
  };

  // Compile outreach pitch replacing placeholders with active lead data
  const compileOutreach = (templateText, lead) => {
    if (!templateText || !lead) return "";
    let compiled = templateText;
    compiled = compiled.replace(/\{\{ContactName\}\}/g, lead.contactName || "there");
    compiled = compiled.replace(/\{\{CompanyName\}\}/g, lead.companyName || "your company");
    compiled = compiled.replace(/\{\{CustomHook\}\}/g, lead.customHook || "");
    return compiled;
  };

  // Pre-load high quality demo campaign for testing interface
  const handleLoadDemoCampaign = () => {
    const demoCampaign = {
      id: 'demo_' + Date.now(),
      date: new Date().toLocaleDateString(),
      businessInfo: {
        name: userProfile.senderCompany || "HyperScale AI Solutions",
        website: "https://hyperscale.ai",
        description: "We build tailored workflow automations and customized sales chatbots powered by Gemini 2.5 models.",
        coreOffer: "B2B AI Automation Consultations",
        valueProposition: "Deploy workflows in 7 days, boosting output by 40% with zero permanent headcount additions",
        targetIndustry: "B2B Software Platforms",
        targetLocation: "San Francisco, CA",
        targetRole: "Head of Operations / CTO"
      },
      groundingAttributions: [
        { uri: "https://news.ycombinator.com", title: "Hacker News Startup Listings" },
        { uri: "https://www.crunchbase.com", title: "SaaS Enterprise Directory" }
      ],
      leads: [
        {
          id: 'lead_demo_1',
          companyName: "Retool Inc",
          website: "https://retool.com",
          contactName: "David Sacks",
          contactTitle: "VP of Business Development",
          email: "david@retool.com",
          phone: "+1 (415) 555-0199",
          warmthScore: 94,
          status: 'New',
          leadReason: "Sourced from real company profile. They have an expanding ecosystem of internal workflows and would benefit from advanced automated customer support modules built with Gemini.",
          customHook: "I was reviewing Retool's native integration lists and realized how a customized AI automation consultation can bridge support SLAs down to milliseconds.",
          sourcedFromUrl: "https://retool.com/about",
          notes: ""
        }
      ],
      outreachTemplates: {
        warmEmail: `Hi {{ContactName}},\n\nI was doing some research on {{CompanyName}} and loved your clear focus on operational excellence. {{CustomHook}}\n\nAt ${userProfile.senderCompany}, we design bespoke Gemini workflow systems. Would you be open to a quick chat next week?\n\nRegards,\n${userProfile.senderName}\n${userProfile.senderCompany}`,
        coldCallScript: `Hi {{ContactName}}, it's ${userProfile.senderName} from ${userProfile.senderCompany}. I noticed {{CompanyName}}'s team is looking closely at operational efficiencies. {{CustomHook}}`,
        linkedinMessage: `Hi {{ContactName}}! Incredible work driving operations at {{CompanyName}}. {{CustomHook}} - ${userProfile.senderName}`
      }
    };

    const updated = [demoCampaign, ...campaigns];
    saveCampaigns(updated);
    setActiveCampaignId(demoCampaign.id);
    setSelectedLead(demoCampaign.leads[0]);
    setViewMode('dashboard');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-indigo-500/35 selection:text-white relative">
      
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setViewMode('welcome')}>
          <div className="bg-gradient-to-tr from-amber-500 via-indigo-600 to-violet-600 p-2 rounded-xl shadow-lg shadow-indigo-500/15 flex items-center justify-center">
            <Coins className="h-6 w-6 text-white" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
              GET LEADS
            </span>
            <span className="block text-[10px] text-amber-400 font-semibold uppercase tracking-wider">SOL Web3 Secured Sourcing</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Mobile campaigns drawer toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 transition-all active:scale-95"
            title="Toggle campaigns panel"
          >
            <Menu className="h-4 w-4" />
          </button>

          {/* Honest key status: shows at a glance whether AI generation is live */}
          <span
            title={hasGeminiKey
              ? "Gemini API key detected — live AI lead generation enabled"
              : "No Gemini API key — live generation disabled, keyless features still work"}
            className={`hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
              hasGeminiKey
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${hasGeminiKey ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            <span>{hasGeminiKey ? 'AI Live' : 'Keyless'}</span>
          </span>

          {/* Account Settings Trigger */}
          <button
            onClick={() => setShowAccountModal(true)}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 text-sm font-semibold transition-all active:scale-95"
            title="Edit personalization settings and Solana Wallet"
          >
            <User className="h-4 w-4 text-indigo-400" />
            <span className="hidden sm:inline">Personalization Profile</span>
          </button>

          <button 
            onClick={() => {
              setFormData({
                businessName: '',
                website: '',
                description: '',
                targetIndustry: '',
                targetLocation: '',
                targetRole: 'Owner / Decision Maker',
              });
              setViewMode('wizard');
            }}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium text-sm transition-all shadow-md shadow-indigo-600/20 hover:shadow-indigo-500/30 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            <span>New Campaign</span>
          </button>
        </div>
      </header>

      {/* Account Settings / Profile Modal */}
      {showAccountModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 relative shadow-2xl animate-fade-in">
            <button 
              onClick={() => setShowAccountModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
                <Settings className="h-5 w-5 text-indigo-400" />
                <h3 className="font-bold text-lg text-slate-100">Personalization & Wallet Profile</h3>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Configure your personalization credentials here. This information automatically signs your outgoing cold emails and is used to verify Solana ledger payments.
              </p>

              <div className="space-y-3.5">
                {/* Personal Sender Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Your Personal Name</label>
                  <input 
                    type="text"
                    value={userProfile.senderName}
                    onChange={(e) => saveProfile({ ...userProfile, senderName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. Alex Sterling"
                  />
                </div>

                {/* Sender Company */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Your Sponsoring Agency/Company Name</label>
                  <input 
                    type="text"
                    value={userProfile.senderCompany}
                    onChange={(e) => saveProfile({ ...userProfile, senderCompany: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. Zenith Consulting Group"
                  />
                </div>

                {/* Solana Wallet Address */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                    <span>Your Solana Wallet Address</span>
                    <span className="text-[10px] text-amber-400 font-mono">Used to Unlock Leads</span>
                  </label>
                  <input 
                    type="text"
                    value={userProfile.userWalletAddress}
                    onChange={(e) => saveProfile({ ...userProfile, userWalletAddress: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    placeholder="e.g. 5W7HnS8pQp21L..."
                  />
                  <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                    This wallet will be queried directly on the Solana Mainnet to verify payments and release your scraped leads.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setShowAccountModal(false)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2 rounded-xl transition-all"
                >
                  Save Profile Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cross-campaign duplicate report modal */}
      {showDupesModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 relative shadow-2xl flex flex-col max-h-[85vh]">
            <button
              onClick={() => setShowDupesModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
              <Search className="h-5 w-5 text-amber-400" />
              <h3 className="font-bold text-lg text-slate-100">Duplicate Leads Across Campaigns</h3>
            </div>
            {!dupeReport || dupeReport.length === 0 ? (
              <div className="text-center py-10 space-y-3">
                <CheckCircle className="h-10 w-10 text-emerald-400 mx-auto" />
                <p className="text-sm text-slate-300 font-semibold">No cross-campaign duplicates found.</p>
                <p className="text-xs text-slate-500">Every lead appears in exactly one campaign.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-400 mb-3">
                  <strong className="text-amber-300">{dupeReport.length}</strong> lead{dupeReport.length > 1 ? 's' : ''} appear{dupeReport.length > 1 ? '' : 's'} in more than one campaign. Nothing was changed — review and clean up manually if you want one canonical copy.
                </p>
                <div className="overflow-y-auto space-y-2.5 pr-1">
                  {dupeReport.map((group, gi) => (
                    <div key={gi} className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/15">
                      <p className="text-xs font-bold text-slate-200 mb-2">
                        {group.entries[0].lead.companyName}
                        <span className="ml-2 text-[10px] font-semibold text-slate-500">in {group.entries.length} campaigns</span>
                      </p>
                      <div className="space-y-1.5">
                        {group.entries.map((e, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-400 truncate">
                              <span className="text-slate-200 font-semibold">{e.campaignName}</span>
                              {e.lead.website && <span className="text-slate-500 font-mono"> · {e.lead.website}</span>}
                              <span className="text-slate-500"> · status: {e.lead.status || 'New'}</span>
                            </span>
                            <button
                              onClick={() => {
                                setShowDupesModal(false);
                                handleSelectCampaign(e.campaignId);
                              }}
                              className="shrink-0 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[10px] font-bold transition-all"
                            >
                              Open campaign
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end pt-4 mt-3 border-t border-slate-800">
              <button
                onClick={() => setShowDupesModal(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 relative shadow-2xl flex flex-col max-h-[88vh]">
            <button
              onClick={() => setShowImportModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
              <Download className="h-5 w-5 text-cyan-400 rotate-180" />
              <h3 className="font-bold text-lg text-slate-100">Import Leads from CSV</h3>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              Paste CSV text or choose a file. Expected columns (case-insensitive, any order):
              <code className="font-mono text-slate-300"> Company, Website, Contact Name, Contact Title, Email, Phone, Score, Reason, Notes</code>.
              Rows without a company name are skipped; duplicates are removed automatically (exact + fuzzy matching).
            </p>

            <div className="flex flex-col sm:flex-row gap-2.5 mb-3">
              <label className="flex-1 cursor-pointer bg-slate-950 border border-dashed border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-300 hover:border-cyan-500 transition-colors text-center">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => handleImportFile(e.target.files[0])}
                />
                <span>📁 Choose CSV file…</span>
              </label>
              <button
                onClick={() => handleImportPreview(importText)}
                className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold border border-slate-700 transition-all"
              >
                Preview
              </button>
            </div>

            <textarea
              rows={7}
              placeholder={"Company,Website,Contact Name,Email,Phone\nAcme Dental,https://acme.com,Jane Smith,jane@acme.com,204-555-0100"}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 resize-y placeholder:text-slate-700"
            />

            {importPreview && (
              <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 overflow-y-auto">
                <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                  <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">{importPreview.parsed} rows read</span>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{importPreview.leads.length} importable</span>
                  {importPreview.dropped > 0 && (
                    <span className="px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">{importPreview.dropped} skipped</span>
                  )}
                  {importPreview.removedDuplicates > 0 && (
                    <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">{importPreview.removedDuplicates} duplicates removed</span>
                  )}
                  {importPreview.blockedCount > 0 && (
                    <span className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">{importPreview.blockedCount} blocked by do-not-contact list</span>
                  )}
                </div>
                {importPreview.errors.map((err, i) => (
                  <p key={i} className="text-[11px] text-slate-400">• {err}</p>
                ))}
                {(importPreview.blockedNotes || []).length > 0 && (
                  <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/20 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Blocked by do-not-contact list</p>
                    {importPreview.blockedNotes.map((note, i) => (
                      <p key={i} className="text-[11px] text-slate-400">• {note}</p>
                    ))}
                  </div>
                )}
                {importPreview.leads.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] text-slate-300">
                      <thead>
                        <tr className="text-left text-slate-500 uppercase">
                          <th className="py-1 pr-3">Company</th>
                          <th className="py-1 pr-3">Website</th>
                          <th className="py-1 pr-3">Contact</th>
                          <th className="py-1">Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.leads.slice(0, 5).map((l, i) => (
                          <tr key={i} className="border-t border-slate-800/60">
                            <td className="py-1.5 pr-3 font-semibold">{l.companyName}</td>
                            <td className="py-1.5 pr-3 text-slate-400">{l.website || '—'}</td>
                            <td className="py-1.5 pr-3 text-slate-400">{l.contactName || '—'}</td>
                            <td className="py-1.5 text-slate-400 font-mono">{l.email || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importPreview.leads.length > 5 && (
                      <p className="text-[11px] text-slate-500 mt-1">…and {importPreview.leads.length - 5} more</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-4 mt-2 border-t border-slate-800">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all"
              >
                Cancel
              </button>
              {activeCampaign && (
                <button
                  onClick={handleMergeImport}
                  disabled={!importPreview || !importPreview.leads.length || importing}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all disabled:opacity-40"
                  title={`Add these leads to "${activeCampaign.businessInfo.name}" (duplicates against existing leads are skipped)`}
                >
                  {importing ? 'Merging…' : `Merge into "${activeCampaign.businessInfo.name}"`}
                </button>
              )}
              <button
                onClick={handleConfirmImport}
                disabled={!importPreview || !importPreview.leads.length || importing}
                className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs rounded-xl transition-all disabled:opacity-40"
              >
                {importing ? 'Importing…' : `Import ${importPreview ? importPreview.leads.length : 0} leads as new campaign`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Legal Document Reader Modal */}
      {activeLegalModal && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 relative shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
            <button 
              onClick={() => setActiveLegalModal(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 transition-colors z-10 p-1 bg-slate-800 rounded-full"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2.5 border-b border-slate-800 pb-4 mb-4">
              <Scale className="h-5 w-5 text-indigo-400" />
              <h3 className="font-bold text-lg text-slate-100 uppercase tracking-wide">
                {activeLegalModal === 'tos' && "Terms of Service"}
                {activeLegalModal === 'tou' && "Terms of Use"}
                {activeLegalModal === 'privacy' && "Privacy Policy"}
              </h3>
            </div>

            {/* Scrollable Document Content */}
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 text-xs text-slate-300 leading-relaxed font-mono">
              {activeLegalModal === 'tos' && (
                <>
                  <p className="text-slate-100 font-bold">Effective Date: June 29, 2026</p>
                  <p>Welcome to Get Leads ("we," "our," "us"). By accessing or utilizing our Web3 platform, on-chain verification contracts, or live-index lead extraction services, you agree to be bound by these Terms of Service. If you do not accept these terms, you are prohibited from utilizing this software.</p>
                  
                  <h4 className="text-slate-100 font-bold uppercase mt-3">1. Web3 Payment & Settle Contract Policy</h4>
                  <p>Our application interfaces with the Solana blockchain ledger via decentralized RPC nodes. Payment is completed in native Solana ($SOL) to our merchant address. Once completed, you provide your transaction signature. We make no guarantees about blockchain network congestion, gas/priority fee structures, or transaction delays resulting from Solana Mainnet validator dropouts.</p>

                  <h4 className="text-slate-100 font-bold uppercase mt-3">2. Service Scope and Lead Disclaimer</h4>
                  <p>Our platform uses live Gemini 2.5 Flash API grounding systems to search and consolidate public data. Lead details, warmth metrics, and matches are derived from indexed public websites and directories. We do not guarantee the response rate of generated leads, nor do we certify that contacts are error-free or up-to-date.</p>

                  <h4 className="text-slate-100 font-bold uppercase mt-3">3. Anti-Abuse Signature Locking</h4>
                  <p>To prevent signature reuse, transaction signatures are bound to an active session identifier. Sharing transaction signatures across multiple users, browsers, or independent teams is strictly prohibited and monitored.</p>
                </>
              )}

              {activeLegalModal === 'tou' && (
                <>
                  <p className="text-slate-100 font-bold">Effective Date: June 29, 2026</p>
                  <p>This Terms of Use agreement governs your daily operational interaction with the Get Leads web interface, local-storage sync profiles, and our integrated Google grounding API engines.</p>
                  
                  <h4 className="text-slate-100 font-bold uppercase mt-3">1. Authorized Platform Use</h4>
                  <p>You are granted a non-exclusive, non-transferable right to extract lead details corresponding to your purchased pricing tier. You agree not to abuse or script automated bot requests to our backoff endpoints, perform denial-of-service attempts, or reverse-engineer our proprietary Web3 block observer scripts.</p>

                  <h4 className="text-slate-100 font-bold uppercase mt-3">2. Merchant Transaction Claims</h4>
                  <p>Due to the irreversible nature of distributed ledger technologies, all Solana settlements are final. Refunds are not possible under any circumstance. If a transaction fails to verify, you must submit a valid on-chain signature that matches the merchant address, amount, and timestamp associated with your profile wallet.</p>
                </>
              )}

              {activeLegalModal === 'privacy' && (
                <>
                  <p className="text-slate-100 font-bold">Effective Date: June 29, 2026</p>
                  <p>We are dedicated to safeguarding your on-chain and off-chain data profiles. This Privacy Policy details how we handle information in accordance with decentralized ledger structures.</p>
                  
                  <h4 className="text-slate-100 font-bold uppercase mt-3">1. Information We Collect</h4>
                  <p>We do NOT maintain traditional server-side databases. Your personal profile, company name, local campaign logs, and sourced B2B leads list are stored entirely on your device via secure Local Storage. We only collect:</p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li>Your public Solana Wallet address to track transaction validation.</li>
                    <li>On-chain signature hashes provided during verification checks.</li>
                  </ul>

                  <h4 className="text-slate-100 font-bold uppercase mt-3">2. Public Ledger Disclaimer</h4>
                  <p>Any payment made using $SOL on the Solana blockchain is a matter of public record. Your transaction details, wallet balance, and recipient transfer indices are publicly queryable by any search engine or block explorer. We hold no liability over the exposure of on-chain data patterns.</p>
                </>
              )}
            </div>

            <div className="border-t border-slate-800 pt-4 mt-4 flex justify-end">
              <button
                onClick={() => setActiveLegalModal(null)}
                className="px-5 py-2.5 bg-slate-850 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-xl transition-all"
              >
                Close Compliance Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row h-[calc(100vh-73px)] overflow-hidden">
        
        {/* Left Sidebar - Campaign Lists */}
        <aside className={`${sidebarOpen ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-r border-slate-800/80 bg-slate-900/40 p-4 flex-col space-y-4 overflow-y-auto shrink-0 justify-between absolute md:static inset-x-0 top-[73px] bottom-0 z-30`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Campaigns</h3>
              <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
                {campaigns.length} Active
              </span>
            </div>

            {campaigns.length >= 2 && (
              <button
                onClick={handleScanDuplicates}
                className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 text-[11px] font-semibold rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/30 text-slate-300 hover:text-amber-300 transition-all"
                title="Find the same lead appearing in more than one campaign"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Scan for duplicate leads across campaigns</span>
              </button>
            )}

            {campaigns.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-800 bg-slate-900/20 text-center space-y-3">
                <p className="text-xs text-slate-500">No generated lead lists yet.</p>
                <button 
                  onClick={handleLoadDemoCampaign} 
                  className="text-xs text-amber-400 hover:text-amber-300 font-medium underline flex items-center justify-center mx-auto space-x-1"
                >
                  <span>🚀 Load Sample Campaign (No Pay)</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {campaigns.map((camp) => (
                  <div 
                    key={camp.id}
                    onClick={() => handleSelectCampaign(camp.id)}
                    className={`group p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                      activeCampaignId === camp.id 
                        ? 'bg-gradient-to-br from-slate-800/90 to-indigo-950/20 border-indigo-500/40 shadow-md shadow-indigo-500/5' 
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 pr-6">
                        <h4 className="font-semibold text-sm text-slate-200 line-clamp-1 group-hover:text-indigo-300 transition-colors">
                          {camp.businessInfo.name}
                        </h4>
                        <p className="text-xs text-slate-400 font-medium">
                          Targeting: {camp.businessInfo.targetIndustry}
                        </p>
                        <div className="flex items-center space-x-2 text-[10px] text-slate-500 pt-1">
                          <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                            {camp.leads.length} Leads
                          </span>
                          <span>•</span>
                          <span>{camp.date}</span>
                        </div>
                      </div>

                      <button 
                        onClick={(e) => handleDeleteCampaign(camp.id, e)}
                        className="absolute right-2.5 top-2.5 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400 text-slate-500 transition-all"
                        title="Delete Campaign"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Micro Legal Footer inside Sidebar */}
          <div className="border-t border-slate-800/60 pt-4 space-y-2 text-[10px] text-slate-500">
            <div className="flex items-center justify-between">
              <span>SOL Settlement Engine</span>
              <span>v3.0</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setActiveLegalModal('tos')} className="hover:text-slate-300 underline text-left">Terms of Service</button>
              <span>•</span>
              <button onClick={() => setActiveLegalModal('tou')} className="hover:text-slate-300 underline text-left">Terms of Use</button>
              <span>•</span>
              <button onClick={() => setActiveLegalModal('privacy')} className="hover:text-slate-300 underline text-left">Privacy Policy</button>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-950 flex flex-col relative font-sans justify-between">
          
          {/* Main workspace container */}
          <div className="flex-1 flex flex-col">
            {/* Loading Panel */}
            {loading && (
              <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 p-6 text-center">
                <div className="relative mb-8">
                  <div className="h-20 w-20 rounded-full border-t-4 border-b-4 border-indigo-500 animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="h-8 w-8 text-indigo-400 animate-bounce" />
                  </div>
                </div>
                
                <div className="max-w-md space-y-4">
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-indigo-500 bg-clip-text text-transparent">
                    Extracting Grounded Leads...
                  </h3>
                  <p className="text-sm text-slate-400 min-h-[2.5rem]">
                    {loadingStep === 1 && "🌐 Running live index scans of your provided business parameters..."}
                    {loadingStep === 2 && "🔍 Interrogating active Web Directories and search results for real prospects..."}
                    {loadingStep === 3 && "✍️ Custom-tailoring high converting outbound outreach scripts..."}
                  </p>

                  {/* Step progress */}
                  <div className="flex items-center justify-center space-x-2">
                    {[1, 2, 3].map((step) => (
                      <div key={step} className="flex items-center space-x-2">
                        <div className={`h-2.5 w-2.5 rounded-full transition-all ${
                          loadingStep > step
                            ? 'bg-emerald-400'
                            : loadingStep === step
                            ? 'bg-indigo-400 animate-pulse'
                            : 'bg-slate-700'
                        }`} />
                        {step < 3 && <div className="h-px w-8 bg-slate-800" />}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Step {loadingStep} of 3 · duplicates removed automatically · campaigns saved locally
                  </p>
                </div>
              </div>
            )}

            {/* Error Message Box */}
            {apiError && (
              <div className="mx-6 mt-6 p-4 rounded-xl bg-red-950/40 border border-red-500/20 text-red-200 flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-semibold text-sm">Lead Generation Failed</h4>
                  <p className="text-xs text-red-300">{apiError}</p>
                  <button 
                    onClick={() => setApiError(null)} 
                    className="text-xs underline text-red-400 hover:text-red-300 font-medium"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Welcome Onboarding State */}
            {viewMode === 'welcome' && (
              <div className="max-w-4xl mx-auto px-6 py-12 md:py-20 space-y-12 animate-fade-in flex-1">
                
                <div className="space-y-4 text-center">
                  <div className="inline-flex items-center space-x-2 bg-amber-500/10 border border-amber-500/20 px-3.5 py-1 rounded-full text-amber-400 text-xs font-semibold uppercase tracking-wider animate-pulse">
                    <Coins className="h-3.5 w-3.5" />
                    <span>Real Grounded Leads Hub</span>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                    Automated High-Intent Real B2B Leads
                  </h1>
                  <p className="text-base md:text-lg text-slate-400 max-w-2xl mx-auto">
                    Powered directly by live Google Web Grounding. Describe your business niche, checkout with Solana on-chain verification, and scrape exact matching business profiles, decision makers, and direct source citations.
                  </p>
                </div>

                {/* Anti-Abuse Information Alert */}
                <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 flex items-center space-x-3 text-xs text-slate-400">
                  <Lock className="h-5 w-5 text-amber-400 shrink-0" />
                  <p>
                    <strong>Anti-Abuse Lease Enabled:</strong> Submitted transactions are locked to your unique browser session (<span className="font-mono text-indigo-400">{sessionToken.substring(0, 10)}...</span>) and cannot be added or verified in multiple parallel workspaces.
                  </p>
                </div>

                {/* On-Chain Campaign Autopilot Recovery Panel */}
                <div className="p-6 rounded-2xl bg-slate-900 border border-slate-850 space-y-4">
                  <div className="flex items-center space-x-2">
                    <Unlock className="h-5 w-5 text-indigo-400" />
                    <h3 className="font-bold text-sm text-slate-200">Paid and can't see your campaigns? Recover Settle Workspace</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    If you cleared your browser data or lost your session, input the Solana wallet you used to purchase leads. The platform will automatically scan the Solana Mainnet ledger, locate your transaction, bind it to this session, and instantly restore your leads.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <input 
                      type="text"
                      placeholder="Enter your paying Solana Wallet Address..."
                      value={recoveryWallet}
                      onChange={(e) => setRecoveryWallet(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={handleAutopilotRecovery}
                      disabled={recovering}
                      className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-indigo-300 rounded-xl text-xs font-bold border border-slate-700 flex items-center justify-center space-x-1.5 shrink-0 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {recovering ? (
                        <>
                          <Clock className="h-3.5 w-3.5 animate-spin" />
                          <span>Searching Ledger...</span>
                        </>
                      ) : (
                        <>
                          <Key className="h-3.5 w-3.5" />
                          <span>Scan & Restore Campaigns</span>
                        </>
                      )}
                    </button>
                  </div>

                  {recoveryStatus && (
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-850 text-xs leading-relaxed text-indigo-300">
                      {recoveryStatus}
                    </div>
                  )}
                </div>

                {/* Action Cards */}
                <div className="grid md:grid-cols-2 gap-6">
                  
                  {/* Option A: Create Campaign */}
                  <div 
                    onClick={() => setViewMode('wizard')}
                    className="p-6 rounded-2xl border border-indigo-500/20 bg-slate-900/40 hover:bg-slate-900/60 transition-all cursor-pointer group space-y-4 hover:border-indigo-500/40"
                  >
                    <div className="bg-indigo-600/10 p-3 rounded-xl border border-indigo-500/20 w-fit text-indigo-400">
                      <Zap className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-100 group-hover:text-indigo-300 transition-colors">
                        Start Scrape & Prospecting Wizard
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Configure your company parameters, target audience, and select your SOL transaction package.
                      </p>
                    </div>
                    <div className="flex items-center text-xs text-indigo-400 font-semibold group-hover:translate-x-1 transition-transform">
                      <span>Configure and Launch</span>
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </div>
                  </div>

                  {/* Option B: Load Demo */}
                  <div 
                    onClick={handleLoadDemoCampaign}
                    className="p-6 rounded-2xl border border-slate-800 bg-slate-900/20 hover:bg-slate-900/40 transition-all cursor-pointer group space-y-4 hover:border-slate-700"
                  >
                    <div className="bg-slate-800 p-3 rounded-xl w-fit text-slate-400">
                      <Layers className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-200 group-hover:text-white">
                        Try with Demo Data
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Test out the custom outreach templates and lead management features before you make a payment.
                    </p>
                    </div>
                    <div className="flex items-center text-xs text-slate-400 font-semibold group-hover:translate-x-1 transition-transform">
                      <span>Evaluate Free Demo</span>
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </div>
                  </div>

                </div>

                {/* Compliance Disclaimer Notice */}
                <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 flex items-start space-x-3 text-xs text-slate-400">
                  <ShieldAlert className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    By launching a campaign, you verify that you agree to our platform guidelines. Leads are scraped via open search ground-indexing and public listings. You hold full responsibility for outbound messaging CAN-SPAM adherence. Review our full policies in the footer below.
                  </p>
                </div>

              </div>
            )}

            {/* Wizard Input Stage */}
            {viewMode === 'wizard' && (
              <div className="max-w-2xl mx-auto px-6 py-12 space-y-8 animate-fade-in flex-1">
                
                <div className="space-y-2">
                  <button 
                    onClick={() => setViewMode(campaigns.length > 0 ? 'dashboard' : 'welcome')}
                    className="text-xs text-slate-400 hover:text-slate-300 flex items-center space-x-1"
                  >
                    <ChevronRight className="h-3 w-3 rotate-180" />
                    <span>Back</span>
                  </button>
                  <h2 className="text-3xl font-extrabold text-slate-100">
                    Campaign Sourcing Setup
                  </h2>
                  <p className="text-xs text-slate-400">
                    Describe what your business does and define your target audience parameters.
                  </p>
                </div>

                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const errors = validateWizardForm(formData);
                    setFormErrors(errors);
                    if (Object.keys(errors).length === 0) {
                      setViewMode('payment');
                    }
                  }} 
                  className="space-y-6"
                >
                  
                  {/* Business Information Section */}
                  <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/80 space-y-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-indigo-400 flex items-center space-x-1.5">
                      <Briefcase className="h-4 w-4" />
                      <span>Your Business Profile</span>
                    </h3>

                    <div className="grid gap-4">
                      
                      {/* Business Name */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Company/Brand Name *</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Acme Web Agency" 
                          value={formData.businessName}
                          onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                          className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none transition-colors placeholder:text-slate-600 ${formErrors.businessName ? 'border-red-500/60 focus:border-red-500' : 'border-slate-800 focus:border-indigo-500'}`}
                        />
                        {formErrors.businessName && (
                          <p className="text-xs text-red-400 mt-1">{formErrors.businessName}</p>
                        )}
                      </div>

                      {/* Website */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Website Link (We will scrape this if provided)</label>
                        <div className="relative">
                          <Globe className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                          <input 
                            type="url" 
                            placeholder="e.g. https://myacmewebsite.com" 
                            value={formData.website}
                            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                            className={`w-full bg-slate-950 border rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 focus:outline-none transition-colors placeholder:text-slate-600 ${formErrors.website ? 'border-red-500/60 focus:border-red-500' : 'border-slate-800 focus:border-indigo-500'}`}
                        />
                        </div>
                        {formErrors.website && (
                          <p className="text-xs text-red-400 -mt-2">{formErrors.website}</p>
                        )}
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">What do you sell / offer? (Optional)</label>
                        <textarea 
                          rows={3}
                          placeholder="Provide a short description or list of services so the AI knows exactly what leads are the best fit..." 
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none transition-colors placeholder:text-slate-600 resize-none ${formErrors.description ? 'border-red-500/60 focus:border-red-500' : 'border-slate-800 focus:border-indigo-500'}`}
                        />
                        {formErrors.description && (
                          <p className="text-xs text-red-400 mt-1">{formErrors.description}</p>
                        )}
                      </div>

                    </div>
                  </div>

                  {/* Lead Targeting Profile Section */}
                  <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/80 space-y-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-pink-400 flex items-center space-x-1.5">
                      <Search className="h-4 w-4" />
                      <span>Lead Sourcing Parameters</span>
                    </h3>

                    <div className="grid gap-4 sm:grid-cols-2">
                      
                      {/* Target Industry */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Target Industry/Niche *</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Real Estate Agencies, SaaS Startups, Dental Clinics" 
                          value={formData.targetIndustry}
                          onChange={(e) => setFormData({ ...formData, targetIndustry: e.target.value })}
                          className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none transition-colors placeholder:text-slate-600 ${formErrors.targetIndustry ? 'border-red-500/60 focus:border-red-500' : 'border-slate-800 focus:border-indigo-500'}`}
                        />
                        {formErrors.targetIndustry && (
                          <p className="text-xs text-red-400 mt-1">{formErrors.targetIndustry}</p>
                        )}
                      </div>

                      {/* Target Location */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Target Location *</label>
                        <input 
                          type="text" 
                          placeholder="e.g. New York, United Kingdom, Texas" 
                          value={formData.targetLocation}
                          onChange={(e) => setFormData({ ...formData, targetLocation: e.target.value })}
                          className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none transition-colors placeholder:text-slate-600 ${formErrors.targetLocation ? 'border-red-500/60 focus:border-red-500' : 'border-slate-800 focus:border-indigo-500'}`}
                        />
                        {formErrors.targetLocation && (
                          <p className="text-xs text-red-400 mt-1">{formErrors.targetLocation}</p>
                        )}
                      </div>

                      {/* Decision Maker Title */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Target Job Title</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Founder, Marketing Director" 
                          value={formData.targetRole}
                          onChange={(e) => setFormData({ ...formData, targetRole: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                        />
                      </div>

                      {/* Tier Selection */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Select Sourcing Tier</label>
                        <select 
                          value={selectedLeadTier}
                          onChange={(e) => setSelectedLeadTier(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                        >
                          <option value="15">15 Leads ($1 USD)</option>
                          <option value="150">150 Leads ($10 USD)</option>
                          <option value="1500">1,500 Leads ($100 USD)</option>
                          <option value="10000">10,000 Leads ($660 USD)</option>
                        </select>
                      </div>

                    </div>
                  </div>

                  {/* Keyless notice: live AI generation needs a key; everything else works */}
                  {!hasGeminiKey && (
                    <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/20 space-y-3">
                      <div className="flex items-start space-x-3 text-xs text-amber-200/90 leading-relaxed">
                        <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <p>
                          <strong>No Gemini API key configured</strong> — live AI lead generation will not run.
                          Add <code className="font-mono bg-slate-950 px-1.5 py-0.5 rounded">VITE_GEMINI_API_KEY</code> (see
                          .env.example) and rebuild to enable it. In the meantime, the free Sample Campaign works fully,
                          and you can prospect manually with the kit below — no key needed.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleDownloadProspectingKit}
                        className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-bold transition-all active:scale-95"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Download Manual Prospecting Kit (CSV, keyless)</span>
                      </button>
                      <p className="text-[11px] text-amber-200/60 leading-relaxed">
                        Ready-made Google search queries for your niche + location: LinkedIn prospecting, directories,
                        funding signals, and pain-point searches. Open each link, work the results by hand.
                      </p>
                    </div>
                  )}

                  {/* Saved Searches */}
                  <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/80 space-y-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-emerald-400 flex items-center space-x-1.5">
                      <BookmarkPlus className="h-4 w-4" />
                      <span>Saved Searches</span>
                    </h3>

                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        placeholder="Name this search (optional — auto-names from niche + location)"
                        value={searchName}
                        onChange={(e) => setSearchName(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-slate-600"
                      />
                      <button
                        type="button"
                        onClick={handleSaveSearch}
                        className="px-4 py-2.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all active:scale-95 shrink-0"
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" />
                        <span>Save current</span>
                      </button>
                    </div>

                    {savedSearches.length === 0 ? (
                      <p className="text-xs text-slate-500 leading-relaxed">
                        No saved searches yet. Configure the form above and save it to reuse this exact
                        targeting combo in one click later.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {savedSearches.map((s) => (
                          <div
                            key={s.id}
                            onClick={() => handleLoadSearch(s)}
                            className="group flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950 border border-slate-850 hover:border-emerald-500/30 cursor-pointer transition-all"
                            title="Load this search into the form"
                          >
                            <div className="flex items-center space-x-2.5 min-w-0">
                              <History className="h-4 w-4 text-emerald-400 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-200 truncate">{s.name}</p>
                                <p className="text-[10px] text-slate-500 truncate">
                                  {s.params.targetIndustry || '—'} · {s.params.targetLocation || '—'} · {s.createdAt}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSearch(s.id, e)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                              title="Delete saved search"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Submit Action */}
                  <button
                    type="submit"
                    className="w-full bg-gradient-to-r from-amber-500 via-indigo-600 to-violet-600 hover:from-amber-400 hover:to-indigo-500 text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center space-x-2.5 transition-all duration-200 shadow-xl shadow-indigo-600/10 hover:shadow-indigo-600/25 active:scale-[0.99]"
                  >
                    <Coins className="h-5 w-5 text-white animate-bounce" />
                    <span>Configure Checkout ({selectedLeadTier} Leads)</span>
                  </button>

                </form>

              </div>
            )}

            {/* Web3 Solana Checkout Screen */}
            {viewMode === 'payment' && (
              <div className="max-w-xl mx-auto px-6 py-12 space-y-8 animate-fade-in flex-1">
                
                <div className="space-y-2">
                  <button 
                    onClick={() => setViewMode('wizard')}
                    className="text-xs text-slate-400 hover:text-slate-300 flex items-center space-x-1"
                  >
                    <ChevronRight className="h-3 w-3 rotate-180" />
                    <span>Back to setup</span>
                  </button>
                  <h2 className="text-3xl font-extrabold text-slate-100 flex items-center space-x-2.5">
                    <ShieldCheck className="h-8 w-8 text-amber-400" />
                    <span>Solana Web3 Settlement</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Complete the on-chain transfer using your configured wallet to release your leads list.
                  </p>
                </div>

                {/* Transaction Summary Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <span className="text-xs text-slate-400 font-semibold">Sourced Campaign Package</span>
                    <span className="text-xs text-amber-400 font-bold bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                      {selectedLeadTier} Leads
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">Merchant Target Address</span>
                    <span className="font-mono text-slate-300 text-xs truncate max-w-[180px] select-all" title={MERCHANT_SOL_ADDRESS}>
                      {MERCHANT_SOL_ADDRESS}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">Fiat Pricing Equivalent</span>
                    <span className="font-semibold text-slate-200">${getTierPriceUSD(selectedLeadTier)} USD</span>
                  </div>

                  <div className="flex justify-between items-center text-lg font-black border-t border-slate-800 pt-3">
                    <span className="text-slate-200">Required SOL</span>
                    <span className="text-amber-400 font-mono">{requiredSOL} SOL</span>
                  </div>
                </div>

                {/* Payment Steps */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Instructions:</h3>
                  <ol className="list-decimal list-inside text-xs text-slate-400 space-y-2 pl-1 leading-relaxed">
                    <li>Send exactly <strong className="text-amber-400 font-mono">{requiredSOL} SOL</strong> from your configured account wallet to: <code className="bg-slate-950 p-1.5 rounded font-mono text-slate-200 select-all">{MERCHANT_SOL_ADDRESS}</code></li>
                    <li>Paste the Solana transaction hash signature below.</li>
                    <li>Click **Verify & Pull Leads** to watch the blockchain ledger and extract your grounded leads!</li>
                  </ol>
                </div>

                {/* Web3 Verifier Form */}
                <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 space-y-4">
                  
                  {/* Transaction hash signature */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Solana Transaction Signature (Tx Hash)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 3H9YvWp18uLp4z8X91z... (Copy from explorer or wallet)" 
                      value={paymentSignature}
                      onChange={(e) => setPaymentSignature(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 transition-colors"
                    />
                  </div>

                  {/* Verification response message */}
                  {paymentStatusMessage && (
                    <div className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                      paymentStatusMessage.includes('Verified') 
                        ? 'bg-emerald-950/40 border-emerald-500/20 text-emerald-300' 
                        : 'bg-indigo-950/40 border-indigo-500/20 text-indigo-300'
                    }`}>
                      {paymentStatusMessage}
                    </div>
                  )}

                  {/* CTA Action */}
                  <button
                    type="button"
                    disabled={verifyingPayment}
                    onClick={handleVerifyPayment}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 px-6 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50"
                  >
                    {verifyingPayment ? (
                      <>
                        <Clock className="h-4 w-4 animate-spin" />
                        <span>Verifying On-Chain...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" />
                        <span>Verify & Pull Leads</span>
                      </>
                    )}
                  </button>

                </div>

              </div>
            )}

            {/* Dashboard & workspace State */}
            {viewMode === 'dashboard' && activeCampaign && (
              <div className="flex-1 flex flex-col overflow-hidden animate-fade-in">
                
                {/* Campaign Topbar Information */}
                <section className="bg-slate-900/60 border-b border-slate-800/80 px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <h2 className="text-xl font-bold text-slate-100">{activeCampaign.businessInfo.name}</h2>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center space-x-1 font-mono">
                        <ShieldCheck className="h-3 w-3" />
                        <span>Verification Match OK</span>
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 max-w-2xl line-clamp-1">
                      <span className="font-semibold text-slate-300">Target Industry:</span> {activeCampaign.businessInfo.targetIndustry} | <span className="font-semibold text-slate-300">Region:</span> {activeCampaign.businessInfo.targetLocation}
                    </p>
                  </div>

                  <div className="flex items-center space-x-3">
                    <button 
                      onClick={openImportModal}
                      className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700/60"
                      title="Import leads from your own CSV file"
                    >
                      <Download className="h-3.5 w-3.5 rotate-180" />
                      <span>Import CSV</span>
                    </button>
                    <button 
                      onClick={handleExportCSV}
                      className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700/60"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Export CSV</span>
                    </button>

                    <button 
                      onClick={() => {
                        setFormData({
                          businessName: activeCampaign.businessInfo.name,
                          website: activeCampaign.businessInfo.website,
                          description: activeCampaign.businessInfo.description,
                          targetIndustry: activeCampaign.businessInfo.targetIndustry,
                          targetLocation: activeCampaign.businessInfo.targetLocation,
                          targetRole: activeCampaign.businessInfo.targetRole,
                        });
                        setViewMode('wizard');
                      }}
                      className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-lg shadow-indigo-600/15"
                    >
                      <RefreshCw className="h-3.5 w-3.5 animate-spin-hover" />
                      <span>Purchase More Leads</span>
                    </button>
                  </div>
                </section>

                {/* Dashboard section tabs */}
                <nav className="flex items-center gap-1 px-6 py-2.5 bg-slate-950/40 border-b border-slate-800/60 shrink-0">
                  {[
                    { key: 'leads', label: 'Leads', icon: Users },
                    { key: 'followups', label: 'Follow-ups', icon: CalendarClock, badge: campaignStats && campaignStats.open > 0 ? campaignStats.open : null },
                    { key: 'reports', label: 'Reports', icon: BarChart3 },
                    { key: 'blacklist', label: 'Do-not-contact', icon: Ban, badge: blacklist.length > 0 ? blacklist.length : null },
                  ].map(({ key, label, icon: Icon, badge }) => (
                    <button
                      key={key}
                      onClick={() => setDashTab(key)}
                      className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        dashTab === key
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{label}</span>
                      {badge !== null && badge !== undefined && (
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${dashTab === key ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'}`}>
                          {badge}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>

                {dashTab === 'leads' && (
                <>
                {/* Metrics Bar */}
                <section className="grid grid-cols-2 md:grid-cols-5 border-b border-slate-800/40 bg-slate-900/10 shrink-0">
                  <div className="p-4 border-r border-slate-800/40 space-y-1 text-center md:text-left">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Scraped Leads</span>
                    <p className="text-2xl font-black text-slate-100">{activeCampaign.leads.length}</p>
                  </div>
                  <div className="p-4 border-r border-slate-800/40 space-y-1 text-center md:text-left">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">High Intent Match</span>
                    <p className="text-2xl font-black text-indigo-400">
                      {activeCampaign.leads.filter(l => l.warmthScore >= 85).length}
                    </p>
                  </div>
                  <div className="p-4 border-r border-slate-800/40 space-y-1 text-center md:text-left">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Contacted</span>
                    <p className="text-2xl font-black text-emerald-400">
                      {activeCampaign.leads.filter(l => l.status === 'Contacted' || l.status === 'In-Progress' || l.status === 'Converted').length}
                    </p>
                  </div>
                  <div className="p-4 border-r border-slate-800/40 space-y-1 text-center md:text-left">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mean Fit Warmth</span>
                    <p className="text-2xl font-black text-pink-400">
                      {Math.round(activeCampaign.leads.reduce((acc, curr) => acc + curr.warmthScore, 0) / activeCampaign.leads.length || 0)}%
                    </p>
                  </div>
                  <div className="p-4 space-y-1 text-center md:text-left" title="Average completeness of lead records (company, website, contact, email, phone, reason, source)">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Data Quality</span>
                    <p className="text-2xl font-black text-cyan-400">
                      {campaignDataQuality(activeCampaign.leads)}%
                    </p>
                  </div>
                </section>

                {/* Dashboard Layout: Left Leads Table / Right Contact Center */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                  
                  {/* Leads Board List Panel */}
                  <div className="flex-1 overflow-y-auto border-r border-slate-800/80">
                    <div className="px-6 py-4 bg-slate-900/10 border-b border-slate-800/40 sticky top-0 backdrop-blur z-10 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          Grounded Contacts List
                          <span className="ml-2 text-slate-500 font-semibold normal-case tracking-normal">
                            {filteredLeads.length} of {activeCampaign.leads.length} shown
                          </span>
                        </span>
                        <span className="text-xs text-slate-500 hidden sm:flex items-center space-x-1.5 font-semibold">
                          <UserCheck className="h-3.5 w-3.5 text-indigo-400" />
                          <span>Customized for {userProfile.senderName}</span>
                        </span>
                      </div>

                      {/* Search / filter / sort toolbar */}
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                          <input
                            type="text"
                            placeholder="Search company, contact, email, or domain..."
                            value={leadFilter}
                            onChange={(e) => setLeadFilter(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                          />
                          {leadFilter && (
                            <button
                              onClick={() => setLeadFilter('')}
                              className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
                              title="Clear search"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2.5">
                          <div className="relative">
                            <Filter className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                            <select
                              value={statusFilter}
                              onChange={(e) => setStatusFilter(e.target.value)}
                              className="bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 appearance-none"
                              title="Filter by status"
                            >
                              <option value="all">All statuses</option>
                              <option value="New">New</option>
                              <option value="Contacted">Contacted</option>
                              <option value="In-Progress">In-Progress</option>
                              <option value="Converted">Converted</option>
                              <option value="Unqualified">Unqualified</option>
                            </select>
                          </div>
                          <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 appearance-none"
                            title="Sort leads"
                          >
                            <option value="warmth">Sort: Warmth ↓</option>
                            <option value="quality">Sort: Data Quality ↓</option>
                            <option value="company">Sort: Company A–Z</option>
                            <option value="status">Sort: Status</option>
                          </select>
                        </div>
                      </div>

                      {/* Batch selection toolbar: appears when leads are shown */}
                      {filteredLeads.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2.5 pt-1">
                          <button
                            onClick={toggleSelectShown}
                            className="flex items-center space-x-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-all"
                          >
                            <span>{filteredLeads.every((l) => selectedLeadIds.includes(l.id)) ? 'Deselect all shown' : 'Select all shown'}</span>
                          </button>
                          {selectedLeadIds.length > 0 && (
                            <>
                              <span className="text-[11px] font-bold text-indigo-300 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                                {selectedLeadIds.length} selected
                              </span>
                              <div className="flex items-center gap-2">
                                <select
                                  value={batchStatus}
                                  onChange={(e) => setBatchStatus(e.target.value)}
                                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 appearance-none"
                                  title="Apply a status to all selected leads"
                                >
                                  <option value="">Set status…</option>
                                  <option value="New">New</option>
                                  <option value="Contacted">Contacted</option>
                                  <option value="In-Progress">In-Progress</option>
                                  <option value="Converted">Converted</option>
                                  <option value="Unqualified">Unqualified</option>
                                </select>
                                <button
                                  onClick={handleBatchStatus}
                                  disabled={!batchStatus}
                                  className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-40"
                                >
                                  Apply
                                </button>
                                <button
                                  onClick={handleBatchDelete}
                                  className="flex items-center space-x-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  <span>Delete</span>
                                </button>
                                <button
                                  onClick={handleExportSelectedCSV}
                                  className="flex items-center space-x-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-all"
                                  title="Export only the selected leads to CSV"
                                >
                                  <Download className="h-3 w-3" />
                                  <span>Export selected</span>
                                </button>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    placeholder="tag…"
                                    value={batchTagInput}
                                    onChange={(e) => setBatchTagInput(e.target.value)}
                                    className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                                    title="Tag to add to / remove from all selected leads"
                                  />
                                  <button
                                    onClick={handleBulkAddTags}
                                    disabled={!batchTagInput.trim()}
                                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 transition-all disabled:opacity-40"
                                    title="Add this tag to all selected leads"
                                  >
                                    +Tag
                                  </button>
                                  <button
                                    onClick={handleBulkRemoveTags}
                                    disabled={!batchTagInput.trim()}
                                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all disabled:opacity-40"
                                    title="Remove this tag from all selected leads"
                                  >
                                    −Tag
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="divide-y divide-slate-800/80">
                      {filteredLeads.length === 0 && (
                        <div className="p-10 text-center space-y-3">
                          <Search className="h-10 w-10 text-slate-700 mx-auto" />
                          <p className="text-sm text-slate-400 font-semibold">
                            {activeCampaign.leads.length === 0 ? 'No leads in this campaign yet.' : 'No leads match your filters.'}
                          </p>
                          <p className="text-xs text-slate-500">
                            {activeCampaign.leads.length === 0
                              ? 'Run a new campaign from the wizard to source leads.'
                              : 'Try clearing the search or choosing a different status filter.'}
                          </p>
                          {(leadFilter || statusFilter !== 'all') && (
                            <button
                              onClick={() => { setLeadFilter(''); setStatusFilter('all'); }}
                              className="mt-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 transition-all"
                            >
                              Clear filters
                            </button>
                          )}
                        </div>
                      )}
                      {filteredLeads.map((lead) => {
                        const isSelected = selectedLead && selectedLead.id === lead.id;
                        const isChecked = selectedLeadIds.includes(lead.id);
                        const dq = scoreLeadCompleteness(lead);
                        return (
                          <div 
                            key={lead.id}
                            onClick={() => setSelectedLead(lead)}
                            className={`p-4 md:p-5 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                              isSelected 
                                ? 'bg-indigo-950/20 border-l-4 border-indigo-500' 
                                : 'bg-transparent hover:bg-slate-900/30'
                            }`}
                          >
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleLeadSelected(lead.id)}
                                className="mt-1 h-4 w-4 rounded accent-indigo-500 cursor-pointer shrink-0"
                                title="Select lead for batch actions"
                              />
                              <div className="space-y-1.5 flex-1 min-w-0">
                              <div className="flex items-center space-x-2.5">
                                <h4 className="font-bold text-sm text-slate-100 truncate">{lead.companyName}</h4>
                                {lead.website && (
                                  <a 
                                    href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-indigo-400 hover:text-indigo-300 p-0.5 rounded transition-colors flex items-center space-x-0.5"
                                    title={`Visit ${lead.website}`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5 inline" />
                                  </a>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                <span className="text-slate-200 font-medium flex items-center space-x-1">
                                  <User className="h-3.5 w-3.5 text-slate-500 inline" />
                                  <span>{lead.contactName} ({lead.contactTitle})</span>
                                </span>
                              </div>

                              <p className="text-xs text-slate-300 line-clamp-1 bg-slate-900/50 p-1.5 rounded border border-slate-850">
                                <span className="font-semibold text-indigo-400 text-[10px] uppercase mr-1">Match Intent:</span>
                                {lead.leadReason}
                              </p>
                              </div>
                            </div>

                            <div className="flex items-center md:flex-col items-end gap-3 justify-between">
                              {/* Warmth indicator: hot / warm / cold tiers */}
                              <div className="flex items-center space-x-1" title={`Fit score ${lead.warmthScore}/100 — ${lead.warmthScore >= 85 ? 'Hot: obvious current need' : lead.warmthScore >= 65 ? 'Warm: solid fit' : 'Cold: weak fit'}`}>
                                <span className="text-xs font-semibold text-slate-400">Fit:</span>
                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                                  lead.warmthScore >= 85
                                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                    : lead.warmthScore >= 65
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                    : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                }`}>
                                  {lead.warmthScore}%
                                </span>
                              </div>

                              {/* Data-quality badge: how complete/actionable this record is */}
                              <div className="flex items-center space-x-1" title={`Data quality ${dq.score}/100 (grade ${dq.grade})${dq.missing.length ? ' — missing: ' + dq.missing.join(', ') : ' — all key fields present'}`}>
                                <span className="text-xs font-semibold text-slate-400">Data:</span>
                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                                  dq.score >= 75
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : dq.score >= 55
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                    : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                }`}>
                                  {dq.grade}
                                </span>
                              </div>

                              {/* Status Selector */}
                              <select 
                                value={lead.status || 'New'}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleUpdateLead(lead.id, { status: e.target.value })}
                                className={`text-[11px] font-bold rounded-md px-2 py-1 border focus:outline-none transition-all ${
                                  lead.status === 'Converted' 
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                    : lead.status === 'Contacted' 
                                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                    : lead.status === 'In-Progress' 
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                              >
                                <option value="New">New</option>
                                <option value="Contacted">Contacted</option>
                                <option value="In-Progress">In-Progress</option>
                                <option value="Converted">Converted</option>
                                <option value="Unqualified">Unqualified</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Lead Contact Center & Outreach copy generation */}
                  <div className="w-full lg:w-[480px] bg-slate-900/40 p-6 flex flex-col overflow-y-auto space-y-6">
                    
                    {selectedLead ? (
                      <>
                        {/* Lead Summary Profile */}
                        <div className="space-y-4">
                          <div className="border-b border-slate-800/80 pb-4 space-y-2">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">Selected Target Lead</span>
                            <h3 className="text-xl font-bold text-slate-100">{selectedLead.companyName}</h3>
                            
                            <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                              <div className="space-y-1">
                                <span className="text-slate-500">Decision Maker</span>
                                <p className="font-semibold text-slate-200">{selectedLead.contactName}</p>
                                <p className="text-[11px] text-slate-400">{selectedLead.contactTitle}</p>
                              </div>
                              <div className="space-y-1">
                                <span className="text-slate-500">Warmth Score</span>
                                <div className="flex items-center space-x-1.5 pt-0.5">
                                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-gradient-to-r from-indigo-500 to-pink-500" 
                                      style={{ width: `${selectedLead.warmthScore}%` }}
                                    ></div>
                                  </div>
                                  <span className="font-bold text-slate-300">{selectedLead.warmthScore}%</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Contacts Information copy tags */}
                          <div className="space-y-2.5">
                            {/* Email Field */}
                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-850">
                              <div className="flex items-center space-x-2.5 min-w-0">
                                <div className="p-1.5 rounded bg-slate-900 text-indigo-400 shrink-0">
                                  <Mail className="h-3.5 w-3.5" />
                                </div>
                                <span className="text-xs font-mono text-slate-300 truncate">{selectedLead.email}</span>
                              </div>
                              <button 
                                onClick={() => handleCopyToClipboard(selectedLead.email, 'email')}
                                className="text-slate-500 hover:text-slate-300 p-1.5 hover:bg-slate-900 rounded transition-colors shrink-0"
                                title="Copy Email"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* Phone Field */}
                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-850">
                              <div className="flex items-center space-x-2.5 min-w-0">
                                <div className="p-1.5 rounded bg-slate-900 text-pink-400 shrink-0">
                                  <MapPin className="h-3.5 w-3.5" />
                                </div>
                                <span className="text-xs font-mono text-slate-300 truncate">{selectedLead.phone}</span>
                              </div>
                              <button 
                                onClick={() => handleCopyToClipboard(selectedLead.phone, 'phone')}
                                className="text-slate-500 hover:text-slate-300 p-1.5 hover:bg-slate-900 rounded transition-colors shrink-0"
                                title="Copy Phone"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Source Citation Tracker */}
                          {selectedLead.sourcedFromUrl && (
                            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                              <div className="flex items-center space-x-1 text-[10px] text-amber-400 font-bold uppercase tracking-wider">
                                <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
                                <span>Verified Source Attribution</span>
                              </div>
                              <a 
                                href={selectedLead.sourcedFromUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-slate-400 hover:text-indigo-400 underline truncate block flex items-center space-x-1"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="truncate">{selectedLead.sourcedFromUrl}</span>
                              </a>
                            </div>
                          )}

                          {/* Alignment Hook */}
                          <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/20 to-slate-950 border border-indigo-500/10 space-y-1.5">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center space-x-1.5">
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>Prospect Sales Alignment</span>
                            </h4>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {selectedLead.leadReason}
                            </p>
                          </div>
                        </div>

                        {/* Lead workspace tabs: Profile | Warmth | Follow-ups | Sequences */}
                        <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                          {[
                            { key: 'profile', label: 'Profile', icon: User },
                            { key: 'warmth', label: 'Warmth', icon: Flame },
                            { key: 'followups', label: 'Follow-ups', icon: CalendarClock },
                            { key: 'sequences', label: 'Sequences', icon: Mail },
                          ].map(({ key, label, icon: Icon }) => (
                            <button
                              key={key}
                              onClick={() => setLeadPanelTab(key)}
                              className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center space-x-1 ${
                                leadPanelTab === key
                                  ? 'bg-slate-800 text-white shadow-sm'
                                  : 'text-slate-400 hover:text-slate-300'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{label}</span>
                            </button>
                          ))}
                        </div>

                        {leadPanelTab === 'profile' && (
                        <>
                        {/* AI Generated Personalized Communication copy */}
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Communication Desk</span>
                            
                            {/* Copy Success indicator */}
                            {copiedId && (
                              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                Copied!
                              </span>
                            )}
                          </div>

                          {/* Comm Channel Tabs */}
                          <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                            <button
                              onClick={() => setOutreachType('email_warm')}
                              className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                outreachType === 'email_warm' 
                                  ? 'bg-slate-800 text-white shadow-sm' 
                                  : 'text-slate-400 hover:text-slate-300'
                              }`}
                            >
                              Email Warm
                            </button>
                            <button
                              onClick={() => setOutreachType('cold_call')}
                              className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                outreachType === 'cold_call' 
                                  ? 'bg-slate-800 text-white shadow-sm' 
                                  : 'text-slate-400 hover:text-slate-300'
                              }`}
                            >
                              Call Script
                            </button>
                            <button
                              onClick={() => setOutreachType('linkedin')}
                              className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                outreachType === 'linkedin' 
                                  ? 'bg-slate-800 text-white shadow-sm' 
                                  : 'text-slate-400 hover:text-slate-300'
                              }`}
                            >
                              LinkedIn Message
                            </button>
                          </div>

                          {/* Compiled outreach Box */}
                          <div className="relative group/copy font-mono">
                            <textarea
                              readOnly
                              rows={8}
                              value={
                                outreachType === 'email_warm' 
                                  ? compileOutreach(activeCampaign.outreachTemplates.warmEmail, selectedLead)
                                  : outreachType === 'cold_call'
                                  ? compileOutreach(activeCampaign.outreachTemplates.coldCallScript, selectedLead)
                                  : compileOutreach(activeCampaign.outreachTemplates.linkedinMessage, selectedLead)
                              }
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl p-3.5 text-xs text-slate-300 leading-relaxed resize-none focus:outline-none focus:border-slate-800"
                            />
                            <button
                              onClick={() => {
                                const text = outreachType === 'email_warm' 
                                  ? compileOutreach(activeCampaign.outreachTemplates.warmEmail, selectedLead)
                                  : outreachType === 'cold_call'
                                  ? compileOutreach(activeCampaign.outreachTemplates.coldCallScript, selectedLead)
                                  : compileOutreach(activeCampaign.outreachTemplates.linkedinMessage, selectedLead);
                                handleCopyToClipboard(text, 'outreach_text');
                              }}
                              className="absolute right-3.5 bottom-3.5 flex items-center space-x-1 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 text-[10px] font-bold shadow-md transition-all active:scale-95"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copy outreach</span>
                            </button>
                          </div>
                        </div>

                        {/* Internal Notes */}
                        <div className="space-y-2 pt-2">
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Internal Lead Notes</label>
                          <textarea
                            rows={2}
                            placeholder="Add notes..."
                            value={selectedLead.notes || ''}
                            onChange={(e) => handleUpdateLead(selectedLead.id, { notes: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-700 font-sans"
                          />
                        </div>

                        {/* Lead tags */}
                        <div className="space-y-2 pt-2">
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Tags</label>
                          <div className="flex flex-wrap gap-1.5">
                            {(selectedLead.tags || []).map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] font-semibold"
                              >
                                <span>{t}</span>
                                <button onClick={() => handleRemoveLeadTag(t)} className="hover:text-white" title={`Remove tag ${t}`}>
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                            {(selectedLead.tags || []).length === 0 && (
                              <span className="text-[11px] text-slate-600">No tags yet.</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Add tag, press Enter…"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLeadTag(); } }}
                              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                            />
                            <button
                              onClick={handleAddLeadTag}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-all"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                        </>
                        )}

                        {/* --- Warmth breakdown tab (scoring engine) --- */}
                        {leadPanelTab === 'warmth' && selectedLead && (() => {
                          const { score, tier, signals } = scoreLeadWarmth(selectedLead);
                          const tierColor =
                            tier === 'Hot' ? 'text-red-400 bg-red-500/10 border-red-500/20'
                            : tier === 'Warm' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                            : tier === 'Lukewarm' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
                            : 'text-slate-400 bg-slate-500/10 border-slate-500/20';
                          return (
                            <div className="space-y-3 pt-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Reachability Score</span>
                                <span className={`px-2.5 py-1 rounded-full border text-xs font-bold ${tierColor}`}>
                                  {tier} · {score}/100
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 leading-relaxed">
                                Deterministic heuristic: how reachable this lead is (email, domain, website,
                                social presence, decision-maker, phone) — not AI fit.
                              </p>
                              <div className="space-y-2">
                                {signals.map((s, i) => (
                                  <div key={i} className="p-2.5 rounded-xl bg-slate-950 border border-slate-850 space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-semibold text-slate-200">{s.label}</span>
                                      <span className={`text-xs font-bold ${s.points > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                                        +{s.points}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 leading-relaxed">{s.detail}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* --- Follow-ups tab (task engine) --- */}
                        {leadPanelTab === 'followups' && selectedLead && (
                          <div className="space-y-3 pt-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Follow-up Tasks</span>
                              <button
                                onClick={handleAddSuggestedFollowUps}
                                className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-all"
                                title="Attach the suggested initial-touch / bump / breakup cadence"
                              >
                                Add suggested cadence
                              </button>
                            </div>
                            {(selectedLead.followUps || []).length === 0 ? (
                              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-2">
                                <CalendarClock className="h-6 w-6 text-slate-700 mx-auto" />
                                <p className="text-xs text-slate-500">No follow-up tasks yet. Add one below or use the suggested cadence.</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {(selectedLead.followUps || []).map((t) => {
                                  const overdue = t.status === 'open' && t.dueDate < new Date().toISOString().slice(0, 10);
                                  return (
                                    <div key={t.id} className={`p-2.5 rounded-xl border space-y-1.5 ${t.status === 'open' ? 'bg-slate-950 border-slate-850' : 'bg-slate-950/50 border-slate-800/60 opacity-70'}`}>
                                      <div className="flex items-start justify-between gap-2">
                                        <p className={`text-xs font-semibold ${t.status === 'open' ? 'text-slate-200' : 'text-slate-500 line-through'}`}>{t.title}</p>
                                        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                          overdue ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                          : t.dueDate === new Date().toISOString().slice(0, 10) && t.status === 'open'
                                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                            : 'bg-slate-800 text-slate-400'
                                        }`}>
                                          {t.status === 'done' ? 'Done' : t.status === 'skipped' ? 'Skipped' : overdue ? 'Overdue' : t.dueDate || 'No date'}
                                        </span>
                                      </div>
                                      {t.notes && <p className="text-[11px] text-slate-500">{t.notes}</p>}
                                      <div className="flex items-center gap-1.5">
                                        {t.status === 'open' && (
                                          <>
                                            <button
                                              onClick={() => handleCompleteTask(selectedLead.id, t.id)}
                                              className="px-2 py-1 text-[10px] font-bold rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-all"
                                            >
                                              Done
                                            </button>
                                            <button
                                              onClick={() => {
                                                const reason = window.prompt('Reason for skipping (optional):', '');
                                                if (reason === null) return;
                                                handleSkipTask(selectedLead.id, t.id, reason);
                                              }}
                                              className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
                                            >
                                              Skip
                                            </button>
                                          </>
                                        )}
                                        {t.status !== 'open' && (
                                          <button
                                            onClick={() => handleReopenTask(selectedLead.id, t.id)}
                                            className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
                                          >
                                            Reopen
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">New task</p>
                              <input
                                type="text"
                                placeholder="Task title…"
                                value={taskDraft.title}
                                onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                              />
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  value={taskDraft.dueDate}
                                  onChange={(e) => setTaskDraft({ ...taskDraft, dueDate: e.target.value })}
                                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                                />
                                <select
                                  value={taskDraft.priority}
                                  onChange={(e) => setTaskDraft({ ...taskDraft, priority: e.target.value })}
                                  className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                                >
                                  <option value="low">Low</option>
                                  <option value="normal">Normal</option>
                                  <option value="high">High</option>
                                </select>
                              </div>
                              <input
                                type="text"
                                placeholder="Notes (optional)…"
                                value={taskDraft.notes}
                                onChange={(e) => setTaskDraft({ ...taskDraft, notes: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                              />
                              {taskFormError && <p className="text-[11px] text-red-400">{taskFormError}</p>}
                              <button
                                onClick={handleAddFollowUp}
                                className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all"
                              >
                                Add follow-up
                              </button>
                            </div>
                          </div>
                        )}

                        {/* --- Email sequences tab (DRAFT-ONLY templates) --- */}
                        {leadPanelTab === 'sequences' && selectedLead && (() => {
                          const templates = listSequenceTemplates();
                          const rendered = renderSequence(seqTemplateKey, selectedLead, activeCampaign, userProfile);
                          const warnings = sequenceReadiness(selectedLead);
                          return (
                            <div className="space-y-3 pt-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Email Sequences</span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 uppercase tracking-wider">
                                  Draft only
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 leading-relaxed">
                                Templates render as copy-and-paste drafts. This app never sends email —
                                you send each draft yourself from your own inbox.
                              </p>
                              <div className="grid grid-cols-1 gap-1">
                                {templates.map((t) => (
                                  <button
                                    key={t.key}
                                    onClick={() => setSeqTemplateKey(t.key)}
                                    className={`text-left px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                                      seqTemplateKey === t.key
                                        ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-200'
                                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                                    }`}
                                  >
                                    {t.label}
                                    <span className="ml-2 text-[10px] text-slate-500">{t.steps} steps</span>
                                  </button>
                                ))}
                              </div>
                              {warnings.length > 0 && (
                                <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-1">
                                  {warnings.map((w, i) => (
                                    <p key={i} className="text-[11px] text-amber-400/90 flex items-start space-x-1.5">
                                      <MailWarning className="h-3.5 w-3.5 shrink-0 mt-px" />
                                      <span>{w}</span>
                                    </p>
                                  ))}
                                </div>
                              )}
                              <div className="space-y-3">
                                {rendered.steps.map((step, i) => (
                                  <div key={i} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                        Day {step.day} · Step {i + 1}
                                      </span>
                                      <button
                                        onClick={() => handleCopyToClipboard(`Subject: ${step.subject}\n\n${step.body}`, `seq_${i}`)}
                                        className="flex items-center space-x-1 px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 text-[10px] font-bold transition-all"
                                      >
                                        <Copy className="h-3 w-3" />
                                        <span>Copy draft</span>
                                      </button>
                                    </div>
                                    <p className="text-xs font-bold text-slate-200">Subject: {step.subject}</p>
                                    <pre className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap font-sans">{step.body}</pre>
                                    {step.missing.length > 0 && (
                                      <p className="text-[10px] text-amber-400/80">
                                        Fill in before sending: {step.missing.map((m) => `{{${m}}}`).join(', ')}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                        <Users className="h-10 w-10 text-slate-700" />
                        <p className="text-xs text-slate-500">No leads found or selected.</p>
                      </div>
                    )}

                  </div>

                </div>
                </>
                )}

                {/* --- Follow-ups board tab --- */}
                {dashTab === 'followups' && activeCampaign && (
                  <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Task board</span>
                      {campaignStats && (
                        <>
                          <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 text-[11px] font-bold">{campaignStats.open} open</span>
                          {campaignStats.overdue > 0 && (
                            <span className="px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-bold">{campaignStats.overdue} overdue</span>
                          )}
                          {campaignStats.dueToday > 0 && (
                            <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-bold">{campaignStats.dueToday} due today</span>
                          )}
                          <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 text-[11px] font-semibold">{campaignStats.done} done · {campaignStats.skipped} skipped</span>
                        </>
                      )}
                    </div>
                    {followUpsBoard.length === 0 ? (
                      <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
                        <CalendarClock className="h-8 w-8 text-slate-700 mx-auto" />
                        <p className="text-sm text-slate-400 font-semibold">No follow-up tasks in this campaign.</p>
                        <p className="text-xs text-slate-500">Select a lead and open its Follow-ups tab to add tasks or attach the suggested cadence.</p>
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-slate-900/40 border border-slate-800 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                              <th className="px-4 py-2.5">Task</th>
                              <th className="px-4 py-2.5">Lead</th>
                              <th className="px-4 py-2.5">Due</th>
                              <th className="px-4 py-2.5">Priority</th>
                              <th className="px-4 py-2.5">Status</th>
                              <th className="px-4 py-2.5 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {followUpsBoard.map((t) => (
                              <tr key={t.id} className="border-b border-slate-800/50 hover:bg-slate-900/60">
                                <td className="px-4 py-2.5 font-semibold text-slate-200 max-w-[280px]">
                                  <span className={t.status === 'open' ? '' : 'line-through text-slate-500'}>{t.title}</span>
                                  {t.notes && <p className="text-[11px] text-slate-500 font-normal mt-0.5">{t.notes}</p>}
                                </td>
                                <td className="px-4 py-2.5 text-slate-400">{t.companyName}</td>
                                <td className="px-4 py-2.5">
                                  <span className={`font-mono text-[11px] ${t.overdue ? 'text-red-400 font-bold' : t.dueToday ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                                    {t.dueDate || '—'}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    t.priority === 'high' ? 'bg-red-500/10 text-red-400'
                                    : t.priority === 'low' ? 'bg-slate-800 text-slate-500'
                                    : 'bg-indigo-500/10 text-indigo-300'
                                  }`}>{t.priority}</span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-[11px] text-slate-400 capitalize">{t.status}</span>
                                </td>
                                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                  {t.status === 'open' ? (
                                    <>
                                      <button onClick={() => handleCompleteTask(t.leadId, t.id)} className="px-2 py-1 text-[10px] font-bold rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 mr-1.5 transition-all">Done</button>
                                      <button
                                        onClick={() => {
                                          const reason = window.prompt('Reason for skipping (optional):', '');
                                          if (reason === null) return;
                                          handleSkipTask(t.leadId, t.id, reason);
                                        }}
                                        className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
                                      >Skip</button>
                                    </>
                                  ) : (
                                    <button onClick={() => handleReopenTask(t.leadId, t.id)} className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all">Reopen</button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* --- Reports tab --- */}
                {dashTab === 'reports' && (
                  <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Campaign</span>
                      <select
                        value={reportCampaignId || activeCampaignId}
                        onChange={(e) => setReportCampaignId(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      >
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id}>{c.businessInfo?.name || 'Untitled'} ({(c.leads || []).length} leads)</option>
                        ))}
                      </select>
                    </div>
                    {reportData ? (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: 'Total leads', value: reportData.total, color: 'text-slate-100' },
                            { label: 'Contacted', value: reportData.contacted, color: 'text-emerald-400' },
                            { label: 'Reply rate', value: `${reportData.replyRate}%`, color: 'text-indigo-400' },
                            { label: 'Avg warmth', value: `${reportData.warmth.average}/100`, color: 'text-pink-400' },
                            { label: 'Data quality', value: `${reportData.dataQuality}%`, color: 'text-cyan-400' },
                            { label: 'Hot leads', value: reportData.warmth.hot, color: 'text-red-400' },
                            { label: 'Open follow-ups', value: reportData.followUps.open, color: 'text-amber-400' },
                            { label: 'Overdue tasks', value: reportData.followUps.overdue, color: 'text-red-400' },
                          ].map((s, i) => (
                            <div key={i} className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-1">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{s.label}</span>
                              <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Pipeline funnel</h4>
                            {reportData.funnel.map((f) => (
                              <div key={f.stage} className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-300 font-semibold">{f.stage}</span>
                                  <span className="text-slate-500 font-mono">{f.count} · {f.pct}%</span>
                                </div>
                                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 rounded-full" style={{ width: `${f.pct}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Warmth distribution</h4>
                            {reportData.warmthHistogram.map((b) => {
                              const max = Math.max(1, ...reportData.warmthHistogram.map((x) => x.count));
                              return (
                                <div key={b.label} className="flex items-center gap-2">
                                  <span className="text-[11px] text-slate-500 font-mono w-12">{b.label}</span>
                                  <div className="flex-1 h-5 bg-slate-800/60 rounded overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-amber-500 to-red-500" style={{ width: `${(b.count / max) * 100}%` }} />
                                  </div>
                                  <span className="text-[11px] text-slate-300 font-bold w-8 text-right">{b.count}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Lead sources</h4>
                            {reportData.sources.length === 0 && <p className="text-[11px] text-slate-600">No sources recorded yet.</p>}
                            {reportData.sources.map((s) => (
                              <div key={s.source} className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-300 font-semibold">{s.source}</span>
                                <span className="text-slate-500 font-mono">{s.count} · {s.pct}%</span>
                              </div>
                            ))}
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Data completeness grades</h4>
                            <div className="flex gap-2">
                              {Object.entries(reportData.completenessGrades).map(([g, n]) => (
                                <div key={g} className="flex-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                                  <p className={`text-lg font-black ${g === 'A' ? 'text-emerald-400' : g === 'B' ? 'text-cyan-400' : g === 'C' ? 'text-amber-400' : g === 'D' ? 'text-orange-400' : 'text-red-400'}`}>{g}</p>
                                  <p className="text-[11px] text-slate-500 font-bold">{n}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        {campaignCompareRows.length > 1 && (
                          <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Campaign comparison</h4>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                                    <th className="py-2 pr-3">Campaign</th>
                                    <th className="py-2 pr-3">Leads</th>
                                    <th className="py-2 pr-3">Avg warmth</th>
                                    <th className="py-2 pr-3">Data quality</th>
                                    <th className="py-2 pr-3">Reply rate</th>
                                    <th className="py-2">Open tasks</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {campaignCompareRows.map((r) => (
                                    <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-900/60">
                                      <td className="py-2 pr-3 font-semibold text-slate-200">{r.name}</td>
                                      <td className="py-2 pr-3 text-slate-400">{r.leads}</td>
                                      <td className="py-2 pr-3 text-slate-400">{r.avgWarmth}/100</td>
                                      <td className="py-2 pr-3 text-slate-400">{r.dataQuality}%</td>
                                      <td className="py-2 pr-3 text-slate-400">{r.replyRate}%</td>
                                      <td className="py-2 text-slate-400">{r.openFollowUps}{r.overdue > 0 && <span className="text-red-400 font-bold"> ({r.overdue} overdue)</span>}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-slate-500">No campaigns to report on.</p>
                    )}
                  </div>
                )}

                {/* --- Blacklist / do-not-contact tab --- */}
                {dashTab === 'blacklist' && (
                  <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                        <Ban className="h-4 w-4 text-purple-400" />
                        <span>Do-not-contact list</span>
                      </h3>
                      <p className="text-[11px] text-slate-500 leading-relaxed max-w-2xl">
                        Leads matching any entry here are blocked from CSV imports and excluded from
                        outreach drafts. Match by domain (blocks the company's website and email
                        domain), exact email, or normalized company name.
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Add entry</p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          value={blDraft.type}
                          onChange={(e) => setBlDraft({ ...blDraft, type: e.target.value })}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                        >
                          <option value="domain">Domain</option>
                          <option value="email">Email</option>
                          <option value="name">Company name</option>
                        </select>
                        <input
                          type="text"
                          placeholder={blDraft.type === 'domain' ? 'example.com' : blDraft.type === 'email' ? 'person@example.com' : 'Acme Dental'}
                          value={blDraft.value}
                          onChange={(e) => setBlDraft({ ...blDraft, value: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddBlacklistEntry(); } }}
                          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 placeholder:text-slate-600"
                        />
                        <input
                          type="text"
                          placeholder="Reason (optional)…"
                          value={blDraft.reason}
                          onChange={(e) => setBlDraft({ ...blDraft, reason: e.target.value })}
                          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 placeholder:text-slate-600"
                        />
                        <button
                          onClick={handleAddBlacklistEntry}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition-all"
                        >
                          Add
                        </button>
                      </div>
                      {blFormError && <p className="text-[11px] text-red-400">{blFormError}</p>}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          {blacklist.length} entr{blacklist.length === 1 ? 'y' : 'ies'}
                        </span>
                        <input
                          type="text"
                          placeholder="Search entries…"
                          value={blQuery}
                          onChange={(e) => setBlQuery(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 placeholder:text-slate-600 w-48"
                        />
                      </div>
                      {blacklist.length === 0 ? (
                        <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 text-center">
                          <p className="text-xs text-slate-500">List is empty. CSV imports currently pass through unchecked.</p>
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-slate-900/40 border border-slate-800 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                                <th className="px-4 py-2.5">Type</th>
                                <th className="px-4 py-2.5">Value</th>
                                <th className="px-4 py-2.5">Reason</th>
                                <th className="px-4 py-2.5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {blacklist
                                .filter((e) => {
                                  const q = blQuery.trim().toLowerCase();
                                  if (!q) return true;
                                  return (e.value || '').toLowerCase().includes(q) || (e.reason || '').toLowerCase().includes(q);
                                })
                                .map((e) => (
                                  <tr key={e.id} className="border-b border-slate-800/50 hover:bg-slate-900/60">
                                    <td className="px-4 py-2.5">
                                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300">{e.type}</span>
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-slate-200">{e.value}</td>
                                    <td className="px-4 py-2.5 text-slate-500">{e.reason || '—'}</td>
                                    <td className="px-4 py-2.5 text-right">
                                      <button
                                        onClick={() => handleRemoveBlacklistEntry(e.id)}
                                        className="px-2 py-1 text-[10px] font-bold rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all"
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Onboarding Legal Footer - Displays on welcome/wizard views */}
          {(viewMode === 'welcome' || viewMode === 'wizard' || viewMode === 'payment') && (
            <footer className="border-t border-slate-900 bg-slate-950/65 py-6 px-6 shrink-0 mt-auto text-center">
              <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 font-mono">
                <p>© 2026 Get Leads Platform. Verified Web3 Sourcing Index.</p>
                <div className="flex items-center space-x-4">
                  <button onClick={() => setActiveLegalModal('tos')} className="hover:text-slate-300 transition-colors underline decoration-dotted">
                    Terms of Service
                  </button>
                  <span>•</span>
                  <button onClick={() => setActiveLegalModal('tou')} className="hover:text-slate-300 transition-colors underline decoration-dotted">
                    Terms of Use
                  </button>
                  <span>•</span>
                  <button onClick={() => setActiveLegalModal('privacy')} className="hover:text-slate-300 transition-colors underline decoration-dotted">
                    Privacy Policy
                  </button>
                </div>
              </div>
            </footer>
          )}

        </main>

      </div>
    </div>
  );
}

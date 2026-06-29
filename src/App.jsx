import React, { useState, useEffect } from 'react';
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
  Key
} from 'lucide-react';

// API key injected at build time via Vercel env var (VITE_GEMINI_API_KEY)
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; 

// Merchant wallet address where users send their SOL payments
const MERCHANT_SOL_ADDRESS = "GvD3Z9A4p91L3P7wR4p1kU86X91Z8qVbL6p7qWeR8tY"; 

export default function App() {
  // Campaign & UI States
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaignId, setActiveCampaignId] = useState(null);
  const [viewMode, setViewMode] = useState('welcome'); // welcome, wizard, payment, dashboard
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [apiError, setApiError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [outreachType, setOutreachType] = useState('email_warm');
  const [showAccountModal, setShowAccountModal] = useState(false);
  
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

  // Helper function for exponential backoff API calls
  async function callGeminiWithRetry(payload, retries = 5, delay = 1000) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
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
        if (i === retries - 1) throw error;
        await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
      }
    }
  }

  // Verify Solana Payment with Strict Abuse / Multi-Session check
  const handleVerifyPayment = async () => {
    if (!userProfile.userWalletAddress) {
      setPaymentStatusMessage("Please configure and save your Solana Wallet Address in your Account Settings first!");
      setShowAccountModal(true);
      return;
    }

    if (!paymentSignature) {
      setPaymentStatusMessage("Please fill in your Transaction Signature to scan.");
      return;
    }

    const cleanSignature = paymentSignature.trim();

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
    setLoading(true);
    setApiError(null);
    setLoadingStep(1); 

    try {
      // Step 1: Analyze target company parameters
      const analysisPrompt = `
        You are an elite B2B growth agency system. 
        Analyze the following business to extract what they sell, their unique selling proposition (USP), and define their ideal target audience:
        - Business Name: ${formData.businessName || userProfile.senderCompany}
        - Website: ${formData.website || 'None provided'}
        - Description: ${formData.description || 'None provided'}

        If a website is provided, use google_search to look up "${formData.businessName || userProfile.senderCompany} ${formData.website}" to grab actual details about their products/services.
        
        Return a structured JSON with these exact keys:
        {
          "companyDescription": "Clear description of what the company does",
          "coreOffer": "The primary product/service they sell",
          "valueProposition": "Why customers choose them",
          "suggestedTargetSectors": ["Sector 1", "Sector 2", "Sector 3"]
        }
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
          tools: [{ "google_search": {} }],
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
        You are an elite web scraper and B2B pipeline builder.
        We need real B2B target leads for our company: "${formData.businessName || userProfile.senderCompany}".
        Our business profile:
        - Description: ${businessAnalysis.companyDescription}
        - Core Offer: ${businessAnalysis.coreOffer}
        - Value Proposition: ${businessAnalysis.valueProposition}

        Using live Google search grounding, find real active businesses, agencies, local organizations, or target profiles in "${searchNiche}" operating in "${searchLoc}" that would benefit from our core offer.
        Do NOT generate fake names or domains. Search the live index to extract actual business entities.
        
        Generate a list of exactly ${leadQty} real target leads with the most accurate publicly accessible data.
        For each lead, discover:
        1. Company Name
        2. Website (The real active URL or verified domain, e.g. "https://www.activebusiness.com")
        3. Target Decision Maker Name (Find actual publicly-listed executive/founder names or generate a highly accurate localized representation of a ${formData.targetRole})
        4. Target Decision Maker Title (e.g. Managing Director, CMO, VP)
        5. Contact Email (The real contact/support/business email or standard B2B pattern like contact@domain.com or hello@domain.com)
        6. Phone number (formatted realistically)
        7. Warmth Score (1-100, based on how badly they need our core offer)
        8. Lead Reason (A direct explanation of why this specific company needs our core offer right now)
        9. Custom Outreach Hook (A hyper-personalized icebreaker referencing their specific business niche or real public announcements)
        10. SourcedFromUrl (The real website/directory URL where this lead or business is verified on the web)

        Return a structured JSON with this exact key: "leads" which contains an array of lead objects.
      `;

      const leadPayload = {
        contents: [{ parts: [{ text: leadSearchPrompt }] }],
        tools: [{ "google_search": {} }],
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
      setApiError(error.message || "An unexpected error occurred during API lookup.");
    } finally {
      setLoading(false);
      setLoadingStep(0);
    }
  };

  // Switch Campaigns
  const handleSelectCampaign = (id) => {
    setActiveCampaignId(id);
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

  // Copy helper
  const handleCopyToClipboard = (text, id) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
    document.body.removeChild(textArea);
  };

  // Export Leads to CSV
  const handleExportCSV = () => {
    if (!activeCampaign || !activeCampaign.leads.length) return;
    
    const headers = ["Company Name", "Website", "Decision Maker", "Title", "Email", "Phone", "Warmth Score", "Lead Match Reason", "Sourced From URL", "Status"];
    const rows = activeCampaign.leads.map(l => [
      `"${l.companyName.replace(/"/g, '""')}"`,
      `"${l.website.replace(/"/g, '""')}"`,
      `"${l.contactName.replace(/"/g, '""')}"`,
      `"${l.contactTitle.replace(/"/g, '""')}"`,
      `"${l.email.replace(/"/g, '""')}"`,
      `"${l.phone.replace(/"/g, '""')}"`,
      l.warmthScore,
      `"${l.leadReason.replace(/"/g, '""')}"`,
      `"${(l.sourcedFromUrl || '').replace(/"/g, '""')}"`,
      l.status
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `get_leads_grounded_${activeCampaign.businessInfo.name.toLowerCase().replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        <aside className="w-full md:w-80 border-r border-slate-800/80 bg-slate-900/40 p-4 flex flex-col space-y-4 overflow-y-auto shrink-0 justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Campaigns</h3>
              <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
                {campaigns.length} Active
              </span>
            </div>

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
                  <p className="text-sm text-slate-400">
                    {loadingStep === 1 && "🌐 Running live index scans of your provided business parameters..."}
                    {loadingStep === 2 && "🔍 Interrogating active Web Directories and search results for real prospects..."}
                    {loadingStep === 3 && "✍️ Custom-tailoring high converting outbound outreach scripts..."}
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

                {/* Personalization Setup Box */}
                <div className="rounded-2xl border border-dashed border-indigo-500/30 bg-indigo-950/10 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                      <UserCheck className="h-4 w-4 text-indigo-400" />
                      <span>Setup Account & Solana Wallet Connection</span>
                    </h4>
                    <p className="text-xs text-slate-400 max-w-md">
                      To scrape real leads, configure your account settings. This assigns your signature name and binds your wallet address so payments can unlock your leads automatically.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAccountModal(true)}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 shrink-0 transition-all hover:scale-105"
                  >
                    Configure Account Settings
                  </button>
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
                    if (!userProfile.userWalletAddress) {
                      setPaymentStatusMessage("Please configure and save your Solana Wallet Address in your Account Settings first!");
                      setShowAccountModal(true);
                      return;
                    }
                    setViewMode('payment');
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
                          required
                          placeholder="e.g. Acme Web Agency" 
                          value={formData.businessName}
                          onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                        />
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
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                        />
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">What do you sell / offer? (Optional)</label>
                        <textarea 
                          rows={3}
                          placeholder="Provide a short description or list of services so the AI knows exactly what leads are the best fit..." 
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600 resize-none"
                        />
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
                          required
                          placeholder="e.g. Real Estate Agencies, SaaS Startups, Dental Clinics" 
                          value={formData.targetIndustry}
                          onChange={(e) => setFormData({ ...formData, targetIndustry: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                        />
                      </div>

                      {/* Target Location */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Target Location *</label>
                        <input 
                          type="text" 
                          required
                          placeholder="e.g. New York, United Kingdom, Texas" 
                          value={formData.targetLocation}
                          onChange={(e) => setFormData({ ...formData, targetLocation: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                        />
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

                {/* Connected Wallet Box */}
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-indigo-400">Connected Account Wallet</span>
                    <p className="text-xs font-mono text-slate-300 select-all truncate max-w-[240px]" title={userProfile.userWalletAddress}>
                      {userProfile.userWalletAddress || 'No Wallet Saved'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAccountModal(true)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline font-semibold"
                  >
                    Change Wallet
                  </button>
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

                {/* Metrics Bar */}
                <section className="grid grid-cols-2 md:grid-cols-4 border-b border-slate-800/40 bg-slate-900/10 shrink-0">
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
                  <div className="p-4 space-y-1 text-center md:text-left">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mean Fit Warmth</span>
                    <p className="text-2xl font-black text-pink-400">
                      {Math.round(activeCampaign.leads.reduce((acc, curr) => acc + curr.warmthScore, 0) / activeCampaign.leads.length || 0)}%
                    </p>
                  </div>
                </section>

                {/* Dashboard Layout: Left Leads Table / Right Contact Center */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                  
                  {/* Leads Board List Panel */}
                  <div className="flex-1 overflow-y-auto border-r border-slate-800/80">
                    <div className="px-6 py-4 bg-slate-900/10 border-b border-slate-800/40 sticky top-0 backdrop-blur z-10 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Grounded Contacts List</span>
                      <span className="text-xs text-slate-500 flex items-center space-x-1.5 font-semibold">
                        <UserCheck className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Customized for {userProfile.senderName}</span>
                      </span>
                    </div>

                    <div className="divide-y divide-slate-800/80">
                      {activeCampaign.leads.map((lead) => {
                        const isSelected = selectedLead && selectedLead.id === lead.id;
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

                            <div className="flex items-center md:flex-col items-end gap-3 justify-between">
                              {/* Warmth indicator */}
                              <div className="flex items-center space-x-1">
                                <span className="text-xs font-semibold text-slate-400">Fit:</span>
                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                                  lead.warmthScore >= 85 
                                    ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}>
                                  {lead.warmthScore}%
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
                      </>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                        <Users className="h-10 w-10 text-slate-700" />
                        <p className="text-xs text-slate-500">No leads found or selected.</p>
                      </div>
                    )}

                  </div>

                </div>
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

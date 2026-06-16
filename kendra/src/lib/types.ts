/** Shared shapes returned by the /api/v1/kendra + /api/v1/crop-reports API. */

export type KendraStage = 'UNREGISTERED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SignedDoc { url: string | null; expiresInSec: number }

export interface KendraStatus {
  id: string;
  phone: string | null;
  name: string | null;
  role: string;
  businessType: string | null;
  kycStatus: string | null;
  stage: KendraStage;
  location: {
    district: string | null;
    taluka: string | null;
    village: string | null;
    pincode: string | null;
    state: string | null;
  };
  licence: {
    number: string | null;
    type: string | null;
    issuingState: string | null;
    expiry: string | null;
    verifiedAt: string | null;
    rejectedReason: string | null;
    documents: SignedDoc[];
    documentCount: number;
  } | null;
}

export interface InboxFarmer {
  id: string;
  name: string | null;
  phone: string | null;
  village: string | null;
  taluka: string | null;
  district: string | null;
}

export interface InboxReport {
  id: string;
  cropType: string;
  growthStage?: string;
  primaryDisease: string;
  riskLevel: string;
  overallRisk?: number;
  confidenceScore?: number;
  imageCount?: number;
  createdAt: string;
}

export type FulfillmentMode = 'NONE' | 'COLLECT' | 'DELIVERY';

export interface Share {
  id: string;
  reportId: string;
  status: 'PENDING' | 'REPLIED' | 'CLOSED';
  message: string | null;
  sellerReply: string | null;
  recommendedSku: string | null;
  available: boolean;
  fulfillment: FulfillmentMode;
  fulfillmentNote: string | null;
  readAt: string | null;
  repliedAt: string | null;
  createdAt: string;
  farmer?: InboxFarmer;
  report?: InboxReport & {
    symptoms?: string[];
    fullReport?: Record<string, unknown>;
    weatherSnapshot?: Record<string, unknown> | null;
  };
}

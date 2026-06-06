-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FARMER', 'VERIFIED_FARMER', 'LABOUR_PROVIDER', 'MACHINERY_OWNER', 'ADMIN', 'SELLER');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'RENTED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AnimalGender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_UPDATE', 'BOOKING_UPDATE', 'NEW_MESSAGE', 'NEW_COMMENT', 'POST_LIKE', 'SYSTEM', 'CROP_REPORT_RECEIVED', 'CROP_REPORT_REPLIED');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('PENDING', 'REPLIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PostScope" AS ENUM ('ALL', 'DISTRICT', 'CITY');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "CropCategory" AS ENUM ('CEREAL', 'PULSE', 'OILSEED', 'VEGETABLE', 'FRUIT', 'CASH_CROP', 'FODDER');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Education" AS ENUM ('NONE', 'PRIMARY', 'SECONDARY', 'GRADUATE', 'POST_GRADUATE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "GrowthStage" AS ENUM ('PLANNING', 'LAND_PREP', 'SOWING', 'VEGETATIVE', 'FLOWERING', 'FRUITING', 'MATURITY', 'HARVESTED');

-- CreateEnum
CREATE TYPE "IrrigationSystem" AS ENUM ('DRIP', 'SPRINKLER', 'FLOOD', 'FURROW', 'RAINFED', 'MIXED');

-- CreateEnum
CREATE TYPE "LandOwnership" AS ENUM ('OWNED', 'LEASED', 'SHARED_CROPPING', 'FAMILY');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('BASIC', 'FARM', 'CROP', 'COMPLETE');

-- CreateEnum
CREATE TYPE "PredictionType" AS ENUM ('SEED_QUANTITY', 'CROP_SUGGESTION', 'INCOME_FORECAST', 'YIELD_FORECAST', 'PEST_RISK', 'FERTILIZER_PLAN', 'IRRIGATION_PLAN');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('KHARIF', 'RABI', 'ZAID', 'PERENNIAL');

-- CreateEnum
CREATE TYPE "SoilReportSource" AS ENUM ('GOVERNMENT_SHC', 'PRIVATE_LAB', 'SELF_TEST', 'AI_OCR');

-- CreateEnum
CREATE TYPE "SoilType" AS ENUM ('BLACK_COTTON', 'RED', 'ALLUVIAL', 'SANDY', 'LATERITE', 'CLAY_LOAM', 'SANDY_LOAM', 'UNKNOWN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "avatar" TEXT,
    "statusQuote" TEXT,
    "role" "Role" NOT NULL DEFAULT 'FARMER',
    "language" TEXT NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "pincode" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'Maharashtra',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessType" TEXT,
    "gstNumber" TEXT,
    "gstOptOut" BOOLEAN NOT NULL DEFAULT false,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "profileCompletion" INTEGER NOT NULL DEFAULT 0,
    "taluka" TEXT,
    "village" TEXT,
    "aadhaarLast4" TEXT,
    "activeFarmId" TEXT,
    "annualHouseholdIncome" DOUBLE PRECISION,
    "dateOfBirth" TIMESTAMP(3),
    "dependents" INTEGER,
    "education" "Education",
    "familySize" INTEGER,
    "farmingExperienceYrs" INTEGER,
    "gender" "Gender",
    "hasKisanCreditCard" BOOLEAN NOT NULL DEFAULT false,
    "hasPmKisanAccount" BOOLEAN NOT NULL DEFAULT false,
    "hasSoilHealthCard" BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt" TIMESTAMP(3),
    "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'BASIC',
    "preferredContactMethod" TEXT,
    "preferredMandi" TEXT,
    "totalFarms" INTEGER NOT NULL DEFAULT 0,
    "totalLandAcres" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankHolderName" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "aadharNumber" TEXT,
    "panNumber" TEXT,
    "kycDocumentUrls" TEXT[],
    "kycVerifiedAt" TIMESTAMP(3),
    "kycRejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_details" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "village" TEXT,
    "district" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "landAcres" DOUBLE PRECISION,
    "cropTypes" TEXT[],
    "soilType" TEXT,
    "irrigationType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_sessions" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "otp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "sessionStartedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT,
    "nameMr" TEXT,
    "nameTa" TEXT,
    "nameKn" TEXT,
    "nameMl" TEXT,
    "nameTe" TEXT,
    "nameBn" TEXT,
    "nameGu" TEXT,
    "namePa" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sellerId" TEXT,
    "name" TEXT NOT NULL,
    "nameHi" TEXT,
    "nameMr" TEXT,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "mrp" DOUBLE PRECISION,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "images" TEXT[],
    "tags" TEXT[],
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "district" TEXT,
    "state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "brand" TEXT,
    "countryOfOrigin" TEXT,
    "harvestDate" TEXT,
    "highlights" TEXT[],
    "manufacturer" TEXT,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "sellScope" TEXT NOT NULL DEFAULT 'district',
    "specifications" JSONB,
    "subcategory" TEXT,
    "taluka" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "village" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'HOME',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "flat" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "landmark" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "deliveryAddress" JSONB NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'cod',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "sellerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_listings" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "animal" TEXT NOT NULL,
    "breed" TEXT NOT NULL,
    "age" TEXT NOT NULL,
    "gender" "AnimalGender" NOT NULL,
    "weight" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "milkYield" TEXT,
    "description" TEXT,
    "images" TEXT[],
    "tags" TEXT[],
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "sellerLocation" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "animal_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machinery_listings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "pricePerDay" DOUBLE PRECISION NOT NULL,
    "pricePerHour" DOUBLE PRECISION,
    "images" TEXT[],
    "location" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ageYears" DOUBLE PRECISION,
    "availableFrom" TIMESTAMP(3),
    "availableTo" TIMESTAMP(3),
    "brand" TEXT,
    "features" TEXT[],
    "fuelType" TEXT,
    "horsePower" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "mileageHours" INTEGER,
    "ownerName" TEXT,
    "ownerPhone" TEXT,
    "pricePerAcre" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "videos" TEXT[],

    CONSTRAINT "machinery_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labour_listings" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skills" TEXT[],
    "pricePerDay" DOUBLE PRECISION NOT NULL,
    "groupSize" INTEGER NOT NULL DEFAULT 1,
    "experience" TEXT,
    "languages" TEXT[],
    "location" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "availableFrom" TIMESTAMP(3),
    "availableTo" TIMESTAMP(3),
    "description" TEXT,
    "groupName" TEXT,
    "image" TEXT,
    "images" TEXT[],
    "lat" DOUBLE PRECISION,
    "leader" TEXT,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "pricePerHour" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "videos" TEXT[],

    CONSTRAINT "labour_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "machineryListingId" TEXT,
    "labourListingId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hours" INTEGER,
    "workerCount" INTEGER DEFAULT 1,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "images" TEXT[],
    "tags" TEXT[],
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "scope" "PostScope" NOT NULL DEFAULT 'ALL',
    "district" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_bookmarks" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_likes" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "createdById" TEXT NOT NULL,
    "district" TEXT,
    "city" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "memberCount" INTEGER NOT NULL DEFAULT 1,
    "lastMessage" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_messages" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_disease_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "cropType" TEXT NOT NULL,
    "growthStage" TEXT NOT NULL,
    "variety" TEXT,
    "fieldArea" TEXT,
    "symptoms" TEXT[],
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overallRisk" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "primaryDisease" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "diagnosisMethod" TEXT NOT NULL DEFAULT 'vision',
    "modelAgreement" BOOLEAN,
    "fullReport" JSONB NOT NULL,
    "weatherSnapshot" JSONB,
    "soilSnapshot" JSONB,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crop_disease_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_report_shares" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "message" TEXT,
    "sellerReply" TEXT,
    "recommendedSku" TEXT,
    "recommendedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "available" BOOLEAN NOT NULL DEFAULT false,
    "status" "ShareStatus" NOT NULL DEFAULT 'PENDING',
    "readAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crop_report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isScanSession" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "structuredData" JSONB,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "modelUsed" TEXT,
    "ragUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planner_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "crop" TEXT,
    "field" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'today',
    "icon" TEXT,
    "color" TEXT,
    "doneAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planner_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disease_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "predictedDisease" TEXT NOT NULL,
    "confirmedDisease" TEXT,
    "farmerAgreed" BOOLEAN NOT NULL,
    "confirmedBy" TEXT NOT NULL DEFAULT 'farmer_self',
    "expertNotes" TEXT,
    "usedForRetrain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disease_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "government_schemes" (
    "id" TEXT NOT NULL,
    "schemeCode" TEXT NOT NULL,
    "schemeName" TEXT NOT NULL,
    "schemeNameHi" TEXT,
    "schemeNameMr" TEXT,
    "ministry" TEXT,
    "type" TEXT NOT NULL,
    "state" TEXT,
    "description" TEXT NOT NULL,
    "benefitsSummary" TEXT NOT NULL,
    "eligibility" JSONB NOT NULL,
    "documentsReq" TEXT[],
    "applicationUrl" TEXT,
    "helpline" TEXT,
    "benefitAmount" DOUBLE PRECISION,
    "benefitType" TEXT NOT NULL,
    "deadline" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fullText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "government_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'interested',
    "notes" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheme_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "transcription" TEXT,
    "transcriptionConf" DOUBLE PRECISION,
    "responseText" TEXT,
    "audioInputUrl" TEXT,
    "audioOutputUrl" TEXT,
    "languageDetected" TEXT,
    "languageRequested" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "whisperModel" TEXT,
    "ttsVoice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "audioInputUrl" TEXT,
    "audioOutputUrl" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "durationSeconds" DOUBLE PRECISION,
    "modelUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weather_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_master" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "nameMr" TEXT,
    "category" TEXT NOT NULL,
    "seasons" TEXT[],
    "maturityDays" INTEGER NOT NULL DEFAULT 120,
    "varieties" JSONB NOT NULL DEFAULT '[]',
    "seedRate" JSONB,
    "spacing" JSONB,
    "fertilizerSchedule" JSONB NOT NULL DEFAULT '[]',
    "irrigationSchedule" JSONB NOT NULL DEFAULT '[]',
    "commonPests" JSONB NOT NULL DEFAULT '[]',
    "commonDiseases" JSONB NOT NULL DEFAULT '[]',
    "harvestIndicators" TEXT[],
    "mspCommodityCode" TEXT,
    "agmarknetCode" TEXT,
    "kcInitial" DOUBLE PRECISION DEFAULT 0.4,
    "kcMid" DOUBLE PRECISION DEFAULT 1.0,
    "kcLate" DOUBLE PRECISION DEFAULT 0.6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msp_rates" (
    "id" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "commodityHi" TEXT,
    "season" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "mspPrice" DOUBLE PRECISION NOT NULL,
    "previousYearMSP" DOUBLE PRECISION,
    "increasePercent" DOUBLE PRECISION,
    "bonusIfAny" DOUBLE PRECISION,
    "procurementAgency" TEXT,
    "procurementStartDate" TIMESTAMP(3),
    "procurementEndDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "msp_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandi_prices" (
    "id" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "commodityHi" TEXT,
    "variety" TEXT,
    "market" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "minPrice" DOUBLE PRECISION NOT NULL,
    "maxPrice" DOUBLE PRECISION NOT NULL,
    "modalPrice" DOUBLE PRECISION NOT NULL,
    "arrivalQty" DOUBLE PRECISION,
    "priceDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'data.gov.in',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandi_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_cache" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "predictionMonth" TEXT NOT NULL,
    "priceTrend" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "nearbyMarkets" TEXT,
    "dataFromDate" TIMESTAMP(3),
    "dataToDate" TIMESTAMP(3),
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prediction_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_data_sync" (
    "id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "state" TEXT,
    "commodity" TEXT,
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "price_data_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "market" TEXT,
    "targetPrice" DOUBLE PRECISION NOT NULL,
    "condition" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" TIMESTAMP(3),
    "notificationMethod" TEXT NOT NULL DEFAULT 'push',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soil_health_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fieldName" TEXT,
    "testDate" TIMESTAMP(3),
    "sampleId" TEXT,
    "nitrogen" DOUBLE PRECISION,
    "phosphorus" DOUBLE PRECISION,
    "potassium" DOUBLE PRECISION,
    "ph" DOUBLE PRECISION,
    "ec" DOUBLE PRECISION,
    "organicCarbon" DOUBLE PRECISION,
    "zinc" DOUBLE PRECISION,
    "iron" DOUBLE PRECISION,
    "manganese" DOUBLE PRECISION,
    "copper" DOUBLE PRECISION,
    "boron" DOUBLE PRECISION,
    "sulphur" DOUBLE PRECISION,
    "ratings" JSONB,
    "recommendations" JSONB,
    "inputMethod" TEXT NOT NULL DEFAULT 'manual',
    "scanImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soil_health_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pest_alerts" (
    "id" TEXT NOT NULL,
    "pest" TEXT NOT NULL,
    "pestHi" TEXT,
    "affectedCrops" TEXT[],
    "severity" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "districts" TEXT[],
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusKm" DOUBLE PRECISION,
    "symptoms" JSONB NOT NULL DEFAULT '[]',
    "solutions" JSONB NOT NULL DEFAULT '{}',
    "triggerConditions" JSONB,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pest_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_calendars" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "sowingDate" TIMESTAMP(3) NOT NULL,
    "maturityDays" INTEGER NOT NULL DEFAULT 120,
    "state" TEXT,
    "district" TEXT,
    "fieldName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_calendar_tasks" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleHi" TEXT,
    "description" TEXT,
    "descriptionHi" TEXT,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "completedDate" TIMESTAMP(3),
    "weatherAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "originalDate" TIMESTAMP(3),
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_calendar_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "irrigation_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "fieldName" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shouldIrrigate" BOOLEAN NOT NULL,
    "reason" TEXT,
    "reasonHi" TEXT,
    "waterAmount" TEXT,
    "bestTime" TEXT,
    "temp" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "rainfall" DOUBLE PRECISION,
    "rainForecast" DOUBLE PRECISION,
    "windSpeed" DOUBLE PRECISION,
    "cropStage" TEXT,
    "etcValue" DOUBLE PRECISION,
    "et0Value" DOUBLE PRECISION,
    "kcValue" DOUBLE PRECISION,
    "farmerAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "irrigation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" TEXT,
    "disabledAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_health_logs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseTimeMs" INTEGER,
    "payloadSizeBytes" INTEGER,
    "errorMessage" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_health_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "chatCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyTokens" INTEGER NOT NULL DEFAULT 0,
    "monthlyCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 100,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 100,
    "lifetimeSpent" INTEGER NOT NULL DEFAULT 0,
    "freeRefillDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_transactions" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "aiModel" TEXT,
    "tokensUsed" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_crop_cycles" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "season" "Season" NOT NULL,
    "year" INTEGER NOT NULL,
    "seasonLabel" TEXT,
    "cropName" TEXT NOT NULL,
    "cropNameMr" TEXT,
    "cropNameHi" TEXT,
    "cropCategory" "CropCategory",
    "variety" TEXT,
    "isHybrid" BOOLEAN NOT NULL DEFAULT false,
    "isOrganic" BOOLEAN NOT NULL DEFAULT false,
    "areaAllocatedAcres" DOUBLE PRECISION NOT NULL,
    "sowingDate" TIMESTAMP(3),
    "expectedHarvestDate" TIMESTAMP(3),
    "actualHarvestDate" TIMESTAMP(3),
    "growthStage" "GrowthStage" NOT NULL DEFAULT 'PLANNING',
    "currentStageUpdatedAt" TIMESTAMP(3),
    "seedName" TEXT,
    "seedBrand" TEXT,
    "seedSource" TEXT,
    "seedQuantityKg" DOUBLE PRECISION,
    "seedCostPerKgInr" DOUBLE PRECISION,
    "seedTotalCostInr" DOUBLE PRECISION,
    "seedTreatment" TEXT,
    "seedTreatmentProduct" TEXT,
    "seedPurchaseDate" TIMESTAMP(3),
    "seedReceiptUrl" TEXT,
    "fertilizersUsed" JSONB NOT NULL DEFAULT '[]',
    "pesticidesUsed" JSONB NOT NULL DEFAULT '[]',
    "irrigationLogs" JSONB NOT NULL DEFAULT '[]',
    "observedEvents" JSONB NOT NULL DEFAULT '[]',
    "activities" JSONB NOT NULL DEFAULT '[]',
    "laborLogs" JSONB NOT NULL DEFAULT '[]',
    "expenseLogs" JSONB NOT NULL DEFAULT '[]',
    "incomeLogs" JSONB NOT NULL DEFAULT '[]',
    "harvestYieldKg" DOUBLE PRECISION,
    "harvestYieldQuintal" DOUBLE PRECISION,
    "harvestYieldPerAcreKg" DOUBLE PRECISION,
    "harvestQualityGrade" TEXT,
    "harvestMoisturePct" DOUBLE PRECISION,
    "saleSoldQuantityKg" DOUBLE PRECISION,
    "salePricePerKgInr" DOUBLE PRECISION,
    "saleTotalRevenueInr" DOUBLE PRECISION,
    "saleBuyerType" TEXT,
    "saleBuyerName" TEXT,
    "saleDate" TIMESTAMP(3),
    "saleMandiName" TEXT,
    "totalInputCostInr" DOUBLE PRECISION,
    "laborCostInr" DOUBLE PRECISION,
    "machineryCostInr" DOUBLE PRECISION,
    "otherCostInr" DOUBLE PRECISION,
    "grossIncomeInr" DOUBLE PRECISION,
    "netProfitInr" DOUBLE PRECISION,
    "profitPerAcreInr" DOUBLE PRECISION,
    "status" "CycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "photos" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_crop_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_soil_reports" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "reportSource" "SoilReportSource" NOT NULL DEFAULT 'SELF_TEST',
    "labName" TEXT,
    "labAddress" TEXT,
    "sampleId" TEXT,
    "testDate" TIMESTAMP(3),
    "reportReceivedDate" TIMESTAMP(3),
    "reportImageUrl" TEXT,
    "reportPdfUrl" TEXT,
    "ocrExtractedText" TEXT,
    "ph" DOUBLE PRECISION,
    "phRating" TEXT,
    "ec" DOUBLE PRECISION,
    "ecUnit" TEXT,
    "ecRating" TEXT,
    "organicCarbon" DOUBLE PRECISION,
    "organicCarbonUnit" TEXT,
    "organicCarbonRating" TEXT,
    "nitrogen" DOUBLE PRECISION,
    "nitrogenUnit" TEXT DEFAULT 'kg/ha',
    "nitrogenRating" TEXT,
    "phosphorus" DOUBLE PRECISION,
    "phosphorusUnit" TEXT DEFAULT 'kg/ha',
    "phosphorusRating" TEXT,
    "potassium" DOUBLE PRECISION,
    "potassiumUnit" TEXT DEFAULT 'kg/ha',
    "potassiumRating" TEXT,
    "sulphur" DOUBLE PRECISION,
    "sulphurRating" TEXT,
    "calcium" DOUBLE PRECISION,
    "calciumRating" TEXT,
    "magnesium" DOUBLE PRECISION,
    "magnesiumRating" TEXT,
    "zinc" DOUBLE PRECISION,
    "zincRating" TEXT,
    "iron" DOUBLE PRECISION,
    "ironRating" TEXT,
    "manganese" DOUBLE PRECISION,
    "manganeseRating" TEXT,
    "copper" DOUBLE PRECISION,
    "copperRating" TEXT,
    "boron" DOUBLE PRECISION,
    "boronRating" TEXT,
    "recommendations" JSONB,
    "recommendationsGeneratedAt" TIMESTAMP(3),
    "recommendationsModelUsed" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "inputMethod" TEXT NOT NULL DEFAULT 'manual_entry',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_soil_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_weather_history" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "district" TEXT,
    "summaryStartDate" TIMESTAMP(3),
    "summaryEndDate" TIMESTAMP(3),
    "monthlyAggregates" JSONB NOT NULL DEFAULT '[]',
    "currentTempC" DOUBLE PRECISION,
    "currentHumidityPct" DOUBLE PRECISION,
    "currentRainfall24hMm" DOUBLE PRECISION,
    "currentWindKph" DOUBLE PRECISION,
    "currentCondition" TEXT,
    "currentAsOf" TIMESTAMP(3),
    "forecast7Day" JSONB NOT NULL DEFAULT '[]',
    "activeAdvisories" JSONB NOT NULL DEFAULT '[]',
    "dataSource" TEXT DEFAULT 'mixed',
    "lastSyncedAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3),

    CONSTRAINT "farm_weather_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farmer_predictions" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "cropCycleId" TEXT,
    "predictionType" "PredictionType" NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "explanationEn" TEXT,
    "explanationMr" TEXT,
    "explanationHi" TEXT,
    "actionItems" TEXT[],
    "modelUsed" TEXT,
    "confidence" DOUBLE PRECISION,
    "costInr" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "validUntil" TIMESTAMP(3),
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farmer_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "farmName" TEXT,
    "farmNameMr" TEXT,
    "farmNameHi" TEXT,
    "farmAlias" TEXT,
    "farmNumber" INTEGER NOT NULL,
    "addressLine1" TEXT,
    "village" TEXT,
    "taluka" TEXT,
    "district" TEXT,
    "state" TEXT DEFAULT 'Maharashtra',
    "pincode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationAccuracyM" DOUBLE PRECISION,
    "landSizeAcres" DOUBLE PRECISION NOT NULL,
    "landSizeHectares" DOUBLE PRECISION,
    "landSizeGunta" DOUBLE PRECISION,
    "landOwnership" "LandOwnership" NOT NULL DEFAULT 'OWNED',
    "landSurveyNumber" TEXT,
    "landKhataNumber" TEXT,
    "sevenTwelveImageUrl" TEXT,
    "soilType" "SoilType" NOT NULL DEFAULT 'UNKNOWN',
    "soilColor" TEXT,
    "latestSoilReportId" TEXT,
    "irrigationSystem" "IrrigationSystem" NOT NULL DEFAULT 'RAINFED',
    "waterSources" TEXT[],
    "borewellDepthFt" DOUBLE PRECISION,
    "hasElectricity" BOOLEAN NOT NULL DEFAULT false,
    "electricityHrsDaily" DOUBLE PRECISION,
    "hasGreenhouse" BOOLEAN NOT NULL DEFAULT false,
    "hasColdStorage" BOOLEAN NOT NULL DEFAULT false,
    "hasFarmPond" BOOLEAN NOT NULL DEFAULT false,
    "hasSolarPump" BOOLEAN NOT NULL DEFAULT false,
    "storageCapacityQt" DOUBLE PRECISION,
    "ownedMachinery" TEXT[],
    "nearbyMandis" JSONB,
    "lastWeatherSyncAt" TIMESTAMP(3),
    "lastPredictionAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "ip" TEXT,
    "requestId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_district_idx" ON "users"("district");

-- CreateIndex
CREATE INDEX "users_kycStatus_idx" ON "users"("kycStatus");

-- CreateIndex
CREATE INDEX "users_activeFarmId_idx" ON "users"("activeFarmId");

-- CreateIndex
CREATE INDEX "users_lastActiveAt_idx" ON "users"("lastActiveAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "seller_profiles_userId_key" ON "seller_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "farm_details_userId_key" ON "farm_details"("userId");

-- CreateIndex
CREATE INDEX "otp_sessions_phone_idx" ON "otp_sessions"("phone");

-- CreateIndex
CREATE INDEX "otp_sessions_expiresAt_idx" ON "otp_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_sellerId_idx" ON "products"("sellerId");

-- CreateIndex
CREATE INDEX "products_district_idx" ON "products"("district");

-- CreateIndex
CREATE INDEX "products_taluka_idx" ON "products"("taluka");

-- CreateIndex
CREATE INDEX "products_isActive_isFeatured_idx" ON "products"("isActive", "isFeatured");

-- CreateIndex
CREATE INDEX "products_isActive_rating_idx" ON "products"("isActive", "rating");

-- CreateIndex
CREATE INDEX "products_createdAt_idx" ON "products"("createdAt");

-- CreateIndex
CREATE INDEX "cart_items_userId_idx" ON "cart_items"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_userId_productId_key" ON "cart_items"("userId", "productId");

-- CreateIndex
CREATE INDEX "saved_addresses_userId_idx" ON "saved_addresses"("userId");

-- CreateIndex
CREATE INDEX "saved_addresses_userId_isDefault_idx" ON "saved_addresses"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_userId_status_idx" ON "orders"("userId", "status");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_sellerId_idx" ON "order_items"("sellerId");

-- CreateIndex
CREATE INDEX "order_items_sellerId_orderId_idx" ON "order_items"("sellerId", "orderId");

-- CreateIndex
CREATE INDEX "reviews_productId_idx" ON "reviews"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_productId_key" ON "reviews"("userId", "productId");

-- CreateIndex
CREATE INDEX "animal_listings_sellerId_idx" ON "animal_listings"("sellerId");

-- CreateIndex
CREATE INDEX "animal_listings_animal_idx" ON "animal_listings"("animal");

-- CreateIndex
CREATE INDEX "animal_listings_status_idx" ON "animal_listings"("status");

-- CreateIndex
CREATE INDEX "animal_listings_createdAt_idx" ON "animal_listings"("createdAt");

-- CreateIndex
CREATE INDEX "chats_sellerId_idx" ON "chats"("sellerId");

-- CreateIndex
CREATE INDEX "chats_buyerId_idx" ON "chats"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "chats_listingId_buyerId_key" ON "chats"("listingId", "buyerId");

-- CreateIndex
CREATE INDEX "chat_messages_chatId_idx" ON "chat_messages"("chatId");

-- CreateIndex
CREATE INDEX "chat_messages_chatId_createdAt_idx" ON "chat_messages"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "machinery_listings_ownerId_idx" ON "machinery_listings"("ownerId");

-- CreateIndex
CREATE INDEX "machinery_listings_category_idx" ON "machinery_listings"("category");

-- CreateIndex
CREATE INDEX "machinery_listings_district_idx" ON "machinery_listings"("district");

-- CreateIndex
CREATE INDEX "machinery_listings_status_idx" ON "machinery_listings"("status");

-- CreateIndex
CREATE INDEX "machinery_listings_status_category_idx" ON "machinery_listings"("status", "category");

-- CreateIndex
CREATE INDEX "machinery_listings_lat_lng_idx" ON "machinery_listings"("lat", "lng");

-- CreateIndex
CREATE INDEX "labour_listings_providerId_idx" ON "labour_listings"("providerId");

-- CreateIndex
CREATE INDEX "labour_listings_district_idx" ON "labour_listings"("district");

-- CreateIndex
CREATE INDEX "labour_listings_status_idx" ON "labour_listings"("status");

-- CreateIndex
CREATE INDEX "labour_listings_lat_lng_idx" ON "labour_listings"("lat", "lng");

-- CreateIndex
CREATE INDEX "bookings_userId_idx" ON "bookings"("userId");

-- CreateIndex
CREATE INDEX "bookings_userId_status_idx" ON "bookings"("userId", "status");

-- CreateIndex
CREATE INDEX "bookings_machineryListingId_idx" ON "bookings"("machineryListingId");

-- CreateIndex
CREATE INDEX "bookings_labourListingId_idx" ON "bookings"("labourListingId");

-- CreateIndex
CREATE INDEX "bookings_startDate_endDate_idx" ON "bookings"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "bookings_createdAt_idx" ON "bookings"("createdAt");

-- CreateIndex
CREATE INDEX "posts_authorId_idx" ON "posts"("authorId");

-- CreateIndex
CREATE INDEX "posts_category_idx" ON "posts"("category");

-- CreateIndex
CREATE INDEX "posts_district_idx" ON "posts"("district");

-- CreateIndex
CREATE INDEX "posts_scope_district_idx" ON "posts"("scope", "district");

-- CreateIndex
CREATE INDEX "posts_createdAt_idx" ON "posts"("createdAt");

-- CreateIndex
CREATE INDEX "post_likes_userId_idx" ON "post_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "post_likes_postId_userId_key" ON "post_likes"("postId", "userId");

-- CreateIndex
CREATE INDEX "post_bookmarks_userId_idx" ON "post_bookmarks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "post_bookmarks_postId_userId_key" ON "post_bookmarks"("postId", "userId");

-- CreateIndex
CREATE INDEX "comments_postId_idx" ON "comments"("postId");

-- CreateIndex
CREATE INDEX "comments_postId_createdAt_idx" ON "comments"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

-- CreateIndex
CREATE INDEX "comment_likes_userId_idx" ON "comment_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "comment_likes_commentId_userId_key" ON "comment_likes"("commentId", "userId");

-- CreateIndex
CREATE INDEX "groups_district_idx" ON "groups"("district");

-- CreateIndex
CREATE INDEX "groups_createdById_idx" ON "groups"("createdById");

-- CreateIndex
CREATE INDEX "group_members_userId_idx" ON "group_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE INDEX "group_messages_groupId_idx" ON "group_messages"("groupId");

-- CreateIndex
CREATE INDEX "group_messages_groupId_createdAt_idx" ON "group_messages"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "group_messages_senderId_idx" ON "group_messages"("senderId");

-- CreateIndex
CREATE INDEX "direct_messages_senderId_receiverId_idx" ON "direct_messages"("senderId", "receiverId");

-- CreateIndex
CREATE INDEX "direct_messages_receiverId_senderId_idx" ON "direct_messages"("receiverId", "senderId");

-- CreateIndex
CREATE INDEX "direct_messages_receiverId_readAt_idx" ON "direct_messages"("receiverId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "crop_disease_reports_userId_idx" ON "crop_disease_reports"("userId");

-- CreateIndex
CREATE INDEX "crop_disease_reports_userId_createdAt_idx" ON "crop_disease_reports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "crop_disease_reports_cropType_idx" ON "crop_disease_reports"("cropType");

-- CreateIndex
CREATE INDEX "crop_disease_reports_pincode_idx" ON "crop_disease_reports"("pincode");

-- CreateIndex
CREATE INDEX "crop_disease_reports_riskLevel_idx" ON "crop_disease_reports"("riskLevel");

-- CreateIndex
CREATE INDEX "crop_disease_reports_conversationId_idx" ON "crop_disease_reports"("conversationId");

-- CreateIndex
CREATE INDEX "crop_report_shares_sellerId_createdAt_idx" ON "crop_report_shares"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "crop_report_shares_sellerId_status_idx" ON "crop_report_shares"("sellerId", "status");

-- CreateIndex
CREATE INDEX "crop_report_shares_farmerId_createdAt_idx" ON "crop_report_shares"("farmerId", "createdAt");

-- CreateIndex
CREATE INDEX "crop_report_shares_reportId_idx" ON "crop_report_shares"("reportId");

-- CreateIndex
CREATE INDEX "ai_conversations_userId_idx" ON "ai_conversations"("userId");

-- CreateIndex
CREATE INDEX "ai_conversations_userId_updatedAt_idx" ON "ai_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ai_conversations_userId_isArchived_idx" ON "ai_conversations"("userId", "isArchived");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_idx" ON "ai_messages"("conversationId");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "planner_tasks_userId_idx" ON "planner_tasks"("userId");

-- CreateIndex
CREATE INDEX "planner_tasks_userId_scheduledFor_idx" ON "planner_tasks"("userId", "scheduledFor");

-- CreateIndex
CREATE INDEX "disease_feedback_reportId_idx" ON "disease_feedback"("reportId");

-- CreateIndex
CREATE INDEX "disease_feedback_farmerAgreed_idx" ON "disease_feedback"("farmerAgreed");

-- CreateIndex
CREATE INDEX "disease_feedback_usedForRetrain_idx" ON "disease_feedback"("usedForRetrain");

-- CreateIndex
CREATE UNIQUE INDEX "disease_feedback_userId_reportId_key" ON "disease_feedback"("userId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "government_schemes_schemeCode_key" ON "government_schemes"("schemeCode");

-- CreateIndex
CREATE INDEX "government_schemes_type_idx" ON "government_schemes"("type");

-- CreateIndex
CREATE INDEX "government_schemes_state_idx" ON "government_schemes"("state");

-- CreateIndex
CREATE INDEX "government_schemes_isActive_idx" ON "government_schemes"("isActive");

-- CreateIndex
CREATE INDEX "government_schemes_isActive_type_idx" ON "government_schemes"("isActive", "type");

-- CreateIndex
CREATE INDEX "scheme_applications_userId_idx" ON "scheme_applications"("userId");

-- CreateIndex
CREATE INDEX "scheme_applications_userId_status_idx" ON "scheme_applications"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_applications_userId_schemeId_key" ON "scheme_applications"("userId", "schemeId");

-- CreateIndex
CREATE INDEX "voice_sessions_userId_idx" ON "voice_sessions"("userId");

-- CreateIndex
CREATE INDEX "voice_sessions_userId_createdAt_idx" ON "voice_sessions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "voice_sessions_conversationId_idx" ON "voice_sessions"("conversationId");

-- CreateIndex
CREATE INDEX "voice_conversations_userId_idx" ON "voice_conversations"("userId");

-- CreateIndex
CREATE INDEX "voice_conversations_userId_updatedAt_idx" ON "voice_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "voice_conversations_userId_isArchived_idx" ON "voice_conversations"("userId", "isArchived");

-- CreateIndex
CREATE INDEX "voice_messages_conversationId_idx" ON "voice_messages"("conversationId");

-- CreateIndex
CREATE INDEX "voice_messages_conversationId_createdAt_idx" ON "voice_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "weather_cache_cacheKey_key" ON "weather_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "weather_cache_expiresAt_idx" ON "weather_cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "crop_master_name_key" ON "crop_master"("name");

-- CreateIndex
CREATE INDEX "crop_master_category_idx" ON "crop_master"("category");

-- CreateIndex
CREATE INDEX "msp_rates_season_year_idx" ON "msp_rates"("season", "year");

-- CreateIndex
CREATE UNIQUE INDEX "msp_rates_commodity_season_year_key" ON "msp_rates"("commodity", "season", "year");

-- CreateIndex
CREATE INDEX "mandi_prices_commodity_state_district_idx" ON "mandi_prices"("commodity", "state", "district");

-- CreateIndex
CREATE INDEX "mandi_prices_commodity_priceDate_idx" ON "mandi_prices"("commodity", "priceDate" DESC);

-- CreateIndex
CREATE INDEX "mandi_prices_expiresAt_idx" ON "mandi_prices"("expiresAt");

-- CreateIndex
CREATE INDEX "prediction_cache_state_district_commodity_predictionMonth_idx" ON "prediction_cache"("state", "district", "commodity", "predictionMonth");

-- CreateIndex
CREATE INDEX "prediction_cache_expiresAt_idx" ON "prediction_cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_cache_state_district_commodity_predictionMonth_key" ON "prediction_cache"("state", "district", "commodity", "predictionMonth");

-- CreateIndex
CREATE INDEX "price_data_sync_syncType_status_idx" ON "price_data_sync"("syncType", "status");

-- CreateIndex
CREATE INDEX "price_data_sync_startedAt_idx" ON "price_data_sync"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "price_alerts_userId_idx" ON "price_alerts"("userId");

-- CreateIndex
CREATE INDEX "price_alerts_commodity_isActive_idx" ON "price_alerts"("commodity", "isActive");

-- CreateIndex
CREATE INDEX "soil_health_records_userId_idx" ON "soil_health_records"("userId");

-- CreateIndex
CREATE INDEX "soil_health_records_userId_createdAt_idx" ON "soil_health_records"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pest_alerts_state_isActive_idx" ON "pest_alerts"("state", "isActive");

-- CreateIndex
CREATE INDEX "pest_alerts_isActive_validUntil_idx" ON "pest_alerts"("isActive", "validUntil");

-- CreateIndex
CREATE INDEX "crop_calendars_userId_isActive_idx" ON "crop_calendars"("userId", "isActive");

-- CreateIndex
CREATE INDEX "crop_calendar_tasks_calendarId_scheduledDate_idx" ON "crop_calendar_tasks"("calendarId", "scheduledDate");

-- CreateIndex
CREATE INDEX "crop_calendar_tasks_status_idx" ON "crop_calendar_tasks"("status");

-- CreateIndex
CREATE INDEX "irrigation_logs_userId_date_idx" ON "irrigation_logs"("userId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_featureKey_key" ON "feature_flags"("featureKey");

-- CreateIndex
CREATE INDEX "api_health_logs_source_timestamp_idx" ON "api_health_logs"("source", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "api_health_logs_timestamp_idx" ON "api_health_logs"("timestamp");

-- CreateIndex
CREATE INDEX "ai_usage_userId_idx" ON "ai_usage"("userId");

-- CreateIndex
CREATE INDEX "ai_usage_userId_date_idx" ON "ai_usage"("userId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_userId_date_key" ON "ai_usage"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credits_userId_key" ON "ai_credits"("userId");

-- CreateIndex
CREATE INDEX "ai_credits_userId_idx" ON "ai_credits"("userId");

-- CreateIndex
CREATE INDEX "ai_credit_transactions_creditId_idx" ON "ai_credit_transactions"("creditId");

-- CreateIndex
CREATE INDEX "ai_credit_transactions_creditId_createdAt_idx" ON "ai_credit_transactions"("creditId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_credit_transactions_type_idx" ON "ai_credit_transactions"("type");

-- CreateIndex
CREATE INDEX "farm_crop_cycles_cropName_idx" ON "farm_crop_cycles"("cropName");

-- CreateIndex
CREATE INDEX "farm_crop_cycles_farmId_season_year_idx" ON "farm_crop_cycles"("farmId", "season", "year");

-- CreateIndex
CREATE INDEX "farm_crop_cycles_farmerId_status_idx" ON "farm_crop_cycles"("farmerId", "status");

-- CreateIndex
CREATE INDEX "farm_crop_cycles_sowingDate_idx" ON "farm_crop_cycles"("sowingDate" DESC);

-- CreateIndex
CREATE INDEX "farm_soil_reports_farmId_testDate_idx" ON "farm_soil_reports"("farmId", "testDate" DESC);

-- CreateIndex
CREATE INDEX "farm_soil_reports_farmerId_isLatest_idx" ON "farm_soil_reports"("farmerId", "isLatest");

-- CreateIndex
CREATE UNIQUE INDEX "farm_weather_history_farmId_key" ON "farm_weather_history"("farmId");

-- CreateIndex
CREATE INDEX "farm_weather_history_farmId_idx" ON "farm_weather_history"("farmId");

-- CreateIndex
CREATE INDEX "farm_weather_history_nextSyncAt_idx" ON "farm_weather_history"("nextSyncAt");

-- CreateIndex
CREATE INDEX "farmer_predictions_farmId_createdAt_idx" ON "farmer_predictions"("farmId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "farmer_predictions_farmerId_predictionType_createdAt_idx" ON "farmer_predictions"("farmerId", "predictionType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "farmer_predictions_validUntil_idx" ON "farmer_predictions"("validUntil");

-- CreateIndex
CREATE INDEX "farms_district_taluka_idx" ON "farms"("district", "taluka");

-- CreateIndex
CREATE INDEX "farms_farmerId_farmNumber_idx" ON "farms"("farmerId", "farmNumber");

-- CreateIndex
CREATE INDEX "farms_farmerId_isActive_idx" ON "farms"("farmerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "farms_farmerId_farmNumber_key" ON "farms"("farmerId", "farmNumber");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_activeFarmId_fkey" FOREIGN KEY ("activeFarmId") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_details" ADD CONSTRAINT "farm_details_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_sessions" ADD CONSTRAINT "otp_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_listings" ADD CONSTRAINT "animal_listings_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "animal_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machinery_listings" ADD CONSTRAINT "machinery_listings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labour_listings" ADD CONSTRAINT "labour_listings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_labourListingId_fkey" FOREIGN KEY ("labourListingId") REFERENCES "labour_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_machineryListingId_fkey" FOREIGN KEY ("machineryListingId") REFERENCES "machinery_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_bookmarks" ADD CONSTRAINT "post_bookmarks_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_bookmarks" ADD CONSTRAINT "post_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_disease_reports" ADD CONSTRAINT "crop_disease_reports_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_disease_reports" ADD CONSTRAINT "crop_disease_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_report_shares" ADD CONSTRAINT "crop_report_shares_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "crop_disease_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_report_shares" ADD CONSTRAINT "crop_report_shares_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_report_shares" ADD CONSTRAINT "crop_report_shares_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_tasks" ADD CONSTRAINT "planner_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disease_feedback" ADD CONSTRAINT "disease_feedback_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "crop_disease_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disease_feedback" ADD CONSTRAINT "disease_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_applications" ADD CONSTRAINT "scheme_applications_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "government_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_applications" ADD CONSTRAINT "scheme_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_conversations" ADD CONSTRAINT "voice_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_messages" ADD CONSTRAINT "voice_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "voice_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soil_health_records" ADD CONSTRAINT "soil_health_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_calendars" ADD CONSTRAINT "crop_calendars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_calendar_tasks" ADD CONSTRAINT "crop_calendar_tasks_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "crop_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "irrigation_logs" ADD CONSTRAINT "irrigation_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credits" ADD CONSTRAINT "ai_credits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "ai_credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_crop_cycles" ADD CONSTRAINT "farm_crop_cycles_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_crop_cycles" ADD CONSTRAINT "farm_crop_cycles_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_soil_reports" ADD CONSTRAINT "farm_soil_reports_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_soil_reports" ADD CONSTRAINT "farm_soil_reports_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_weather_history" ADD CONSTRAINT "farm_weather_history_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_weather_history" ADD CONSTRAINT "farm_weather_history_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farmer_predictions" ADD CONSTRAINT "farmer_predictions_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farmer_predictions" ADD CONSTRAINT "farmer_predictions_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farmer_predictions" ADD CONSTRAINT "farmer_predictions_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "farm_crop_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

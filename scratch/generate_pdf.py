# -*- coding: utf-8 -*-
"""
Standalone Pure-Python PDF Generator for SmartAssets Presentation Guide.
Produces a valid, multi-page, professional PDF without any external C-extensions.
"""

import sys
import os

class SimplePDF:
    def __init__(self, filename="SMART_ASSETS_PRESENTATION_GUIDE.pdf"):
        self.filename = filename
        self.pages = []  # list of byte content for each page stream
        self.objects = [] # list of indirect objects
        self.width = 595.28   # A4 width in pt
        self.height = 841.89  # A4 height in pt
        self.margin_x = 45.0
        self.margin_top = 50.0
        self.margin_bottom = 50.0
        self.curr_y = self.height - self.margin_top
        self.curr_stream = []
        self.page_number = 1

    def new_page(self):
        if self.curr_stream:
            self._draw_footer()
            self.pages.append("".join(self.curr_stream).encode('latin-1', 'replace'))
            self.curr_stream = []
            self.page_number += 1
        self.curr_y = self.height - self.margin_top
        self._draw_header()

    def _draw_header(self):
        # Top rule and document subtitle (except on page 1)
        if self.page_number > 1:
            self.draw_rect(self.margin_x, self.height - 35, self.width - 2 * self.margin_x, 1, 0.85, 0.85, 0.88, fill=True)
            self.draw_text(self.margin_x, self.height - 30, "SMARTASSETS — CAPSTONE DEFENSE & TECHNICAL SPECIFICATION", font="F2", size=8, r=0.45, g=0.5, b=0.58)
            self.draw_text(self.width - self.margin_x - 70, self.height - 30, "SYSTEM ARCHITECTURE", font="F2", size=8, r=0.7, g=0.45, b=0.1)

    def _draw_footer(self):
        # Bottom rule and footer
        self.draw_rect(self.margin_x, 40, self.width - 2 * self.margin_x, 0.8, 0.85, 0.85, 0.88, fill=True)
        self.draw_text(self.margin_x, 28, "CONFIDENTIAL & PROPRIETARY — DSW GROUP PROJECT", font="F1", size=8, r=0.55, g=0.6, b=0.65)
        pg_str = f"Page {self.page_number}"
        self.draw_text(self.width - self.margin_x - 35, 28, pg_str, font="F2", size=8, r=0.4, g=0.45, b=0.5)

    def check_space(self, needed_pt):
        if self.curr_y - needed_pt < self.margin_bottom:
            self.new_page()

    def draw_rect(self, x, y, w, h, r, g, b, fill=True, stroke=False):
        cmd = f"\nq {r:.3f} {g:.3f} {b:.3f} rg "
        if stroke:
            cmd += f"{r:.3f} {g:.3f} {b:.3f} RG 1 w "
        cmd += f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re "
        if fill and stroke:
            cmd += "B Q\n"
        elif fill:
            cmd += "f Q\n"
        else:
            cmd += "S Q\n"
        self.curr_stream.append(cmd)

    def draw_text(self, x, y, text, font="F1", size=10, r=0.1, g=0.15, b=0.2):
        # Escape parenthesis
        clean_text = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        cmd = (
            f"\nBT\n"
            f"/{font} {size} Tf\n"
            f"{r:.3f} {g:.3f} {b:.3f} rg\n"
            f"1 0 0 1 {x:.2f} {y:.2f} Tm\n"
            f"({clean_text}) Tj\n"
            f"ET\n"
        )
        self.curr_stream.append(cmd)

    def add_title(self, text, subtitle=None):
        # Cover header banner
        self.check_space(140)
        box_h = 125
        self.draw_rect(self.margin_x, self.curr_y - box_h, self.width - 2 * self.margin_x, box_h, 0.05, 0.08, 0.15, fill=True)
        # Gold accent line on top of banner
        self.draw_rect(self.margin_x, self.curr_y - 4, self.width - 2 * self.margin_x, 4, 0.85, 0.55, 0.12, fill=True)
        
        # Tag
        self.draw_text(self.margin_x + 18, self.curr_y - 28, "PRODUCTION CAPSTONE DEFENSE SPECIFICATION", font="F2", size=9, r=0.98, g=0.75, b=0.2)
        # Main Title
        self.draw_text(self.margin_x + 18, self.curr_y - 58, text, font="F2", size=24, r=1.0, g=1.0, b=1.0)
        # Subtitle
        if subtitle:
            self.draw_text(self.margin_x + 18, self.curr_y - 82, subtitle, font="F1", size=10.5, r=0.75, g=0.82, b=0.9)
            self.draw_text(self.margin_x + 18, self.curr_y - 100, "Ethereum Sepolia (Solidity 0.8.24) | Google Gemini Vision | React Native Expo 54 | Supabase RLS", font="F3", size=8.5, r=0.6, g=0.7, b=0.8)
        self.curr_y -= (box_h + 20)

    def add_heading1(self, text):
        self.check_space(45)
        self.curr_y -= 10
        self.draw_rect(self.margin_x, self.curr_y - 4, self.width - 2 * self.margin_x, 1.2, 0.8, 0.85, 0.9, fill=True)
        self.draw_rect(self.margin_x, self.curr_y - 4, 30, 2.5, 0.85, 0.55, 0.12, fill=True)
        self.draw_text(self.margin_x, self.curr_y, text.upper(), font="F2", size=14, r=0.06, g=0.1, b=0.18)
        self.curr_y -= 18

    def add_heading2(self, text):
        self.check_space(32)
        self.curr_y -= 6
        self.draw_text(self.margin_x, self.curr_y, text, font="F2", size=11.5, r=0.12, g=0.22, b=0.38)
        self.curr_y -= 16

    def add_paragraph(self, text, indent=0, size=9.5, color=(0.2, 0.25, 0.32), font="F1", line_spacing=13.5):
        max_w = self.width - 2 * self.margin_x - indent
        words = text.split()
        lines = []
        cur_line = []

        # approx 5.2 points per character for Helvetica 9.5pt
        char_w = size * 0.53
        max_chars = int(max_w / char_w)

        for w in words:
            test_line = " ".join(cur_line + [w])
            if len(test_line) <= max_chars:
                cur_line.append(w)
            else:
                lines.append(" ".join(cur_line))
                cur_line = [w]
        if cur_line:
            lines.append(" ".join(cur_line))

        needed = len(lines) * line_spacing + 4
        self.check_space(needed)

        for line in lines:
            self.draw_text(self.margin_x + indent, self.curr_y, line, font=font, size=size, r=color[0], g=color[1], b=color[2])
            self.curr_y -= line_spacing
        self.curr_y -= 3

    def add_bullet(self, title, description, size=9.2):
        full_text = f"{title}: {description}" if title else description
        max_w = self.width - 2 * self.margin_x - 20
        words = full_text.split()
        lines = []
        cur_line = []
        max_chars = int(max_w / (size * 0.53))

        for w in words:
            test_line = " ".join(cur_line + [w])
            if len(test_line) <= max_chars:
                cur_line.append(w)
            else:
                lines.append(" ".join(cur_line))
                cur_line = [w]
        if cur_line:
            lines.append(" ".join(cur_line))

        needed = len(lines) * 13 + 6
        self.check_space(needed)

        # Bullet dot
        self.draw_rect(self.margin_x + 4, self.curr_y + 3, 4, 4, 0.85, 0.55, 0.12, fill=True)

        for idx, line in enumerate(lines):
            self.draw_text(self.margin_x + 16, self.curr_y, line, font="F1", size=size, r=0.2, g=0.25, b=0.3)
            self.curr_y -= 13
        self.curr_y -= 3

    def add_callout(self, quote_text):
        words = quote_text.split()
        lines = []
        cur_line = []
        max_chars = int((self.width - 2 * self.margin_x - 30) / (9.5 * 0.53))

        for w in words:
            test = " ".join(cur_line + [w])
            if len(test) <= max_chars:
                cur_line.append(w)
            else:
                lines.append(" ".join(cur_line))
                cur_line = [w]
        if cur_line:
            lines.append(" ".join(cur_line))

        box_h = len(lines) * 14 + 16
        self.check_space(box_h + 10)

        # Background and left border
        self.draw_rect(self.margin_x, self.curr_y - box_h + 8, self.width - 2 * self.margin_x, box_h, 0.96, 0.97, 0.99, fill=True)
        self.draw_rect(self.margin_x, self.curr_y - box_h + 8, 3.5, box_h, 0.85, 0.55, 0.12, fill=True)

        y_pos = self.curr_y - 4
        for l in lines:
            self.draw_text(self.margin_x + 14, y_pos, l, font="F3", size=9.5, r=0.15, g=0.2, b=0.28)
            y_pos -= 14
        self.curr_y -= (box_h + 6)

    def add_qa(self, q, a):
        # Q&A Box
        q_lines = [q]
        a_words = a.split()
        a_lines = []
        cur = []
        max_chars = int((self.width - 2 * self.margin_x - 30) / (9.0 * 0.53))
        for w in a_words:
            test = " ".join(cur + [w])
            if len(test) <= max_chars:
                cur.append(w)
            else:
                a_lines.append(" ".join(cur))
                cur = [w]
        if cur:
            a_lines.append(" ".join(cur))

        box_h = 22 + len(a_lines) * 13 + 14
        self.check_space(box_h + 8)

        # Container
        self.draw_rect(self.margin_x, self.curr_y - box_h + 8, self.width - 2 * self.margin_x, box_h, 0.98, 0.99, 1.0, fill=True)
        self.draw_rect(self.margin_x, self.curr_y - box_h + 8, 3.5, box_h, 0.15, 0.45, 0.85, fill=True)

        # Question
        self.draw_text(self.margin_x + 14, self.curr_y - 2, q, font="F2", size=9.8, r=0.08, g=0.22, b=0.48)
        y_pos = self.curr_y - 18
        for l in a_lines:
            self.draw_text(self.margin_x + 14, y_pos, l, font="F1", size=9.0, r=0.2, g=0.25, b=0.32)
            y_pos -= 13
        self.curr_y -= (box_h + 6)

    def save(self):
        # Finish final page
        if self.curr_stream:
            self._draw_footer()
            self.pages.append("".join(self.curr_stream).encode('latin-1', 'replace'))

        # Build PDF object hierarchy
        # 1: Catalog
        # 2: Pages
        # 3: Font Helvetica (F1)
        # 4: Font Helvetica-Bold (F2)
        # 5: Font Helvetica-Oblique (F3)
        # 6: Font Courier (F4)
        # 7 .. 7 + 2*N: Page and Content objects
        
        pdf_objs = []
        
        # Obj 1: Catalog
        pdf_objs.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
        
        # Obj 3: Fonts
        pdf_objs.append(b"3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")
        pdf_objs.append(b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n")
        pdf_objs.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>\nendobj\n")
        pdf_objs.append(b"6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n")
        
        page_obj_ids = []
        content_objs = []
        
        base_id = 7
        for idx, page_data in enumerate(self.pages):
            p_id = base_id + idx * 2
            c_id = p_id + 1
            page_obj_ids.append(p_id)
            
            p_obj = (
                f"{p_id} 0 obj\n"
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.width:.2f} {self.height:.2f}] "
                f"/Contents {c_id} 0 R "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> >>\n"
                f"endobj\n"
            ).encode('ascii')
            
            c_obj = (
                f"{c_id} 0 obj\n"
                f"<< /Length {len(page_data)} >>\n"
                f"stream\n"
            ).encode('ascii') + page_data + b"\nendstream\nendobj\n"
            
            content_objs.append((p_obj, c_obj))

        # Obj 2: Pages tree
        kids_str = " ".join([f"{pid} 0 R" for pid in page_obj_ids])
        pages_obj = (
            f"2 0 obj\n"
            f"<< /Type /Pages /Kids [{kids_str}] /Count {len(self.pages)} >>\n"
            f"endobj\n"
        ).encode('ascii')

        # Assemble full file with xref
        header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
        
        all_objs_ordered = {}
        all_objs_ordered[1] = pdf_objs[0]
        all_objs_ordered[2] = pages_obj
        all_objs_ordered[3] = pdf_objs[1]
        all_objs_ordered[4] = pdf_objs[2]
        all_objs_ordered[5] = pdf_objs[3]
        all_objs_ordered[6] = pdf_objs[4]
        
        for idx, (p_obj, c_obj) in enumerate(content_objs):
            p_id = page_obj_ids[idx]
            all_objs_ordered[p_id] = p_obj
            all_objs_ordered[p_id + 1] = c_obj
            
        max_id = max(all_objs_ordered.keys())
        
        body = bytearray(header)
        xref_offsets = {}
        
        for oid in range(1, max_id + 1):
            xref_offsets[oid] = len(body)
            body.extend(all_objs_ordered[oid])
            
        xref_start = len(body)
        xref = [f"xref\n0 {max_id + 1}\n0000000000 65535 f \n".encode('ascii')]
        for oid in range(1, max_id + 1):
            xref.append(f"{xref_offsets[oid]:010d} 00000 n \n".encode('ascii'))
            
        trailer = (
            f"trailer\n<< /Size {max_id + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_start}\n%%EOF\n"
        ).encode('ascii')
        
        with open(self.filename, 'wb') as f:
            f.write(body)
            f.write(b"".join(xref))
            f.write(trailer)
            
        print(f"Generated {self.filename} ({len(self.pages)} pages, {os.path.getsize(self.filename)} bytes)")

def build_presentation_pdf():
    pdf = SimplePDF(r"C:\Users\malul\DSW_GROUP_PROJECT\SMART_ASSETS\SMART_ASSETS_PRESENTATION_GUIDE.pdf")
    pdf.new_page()

    # COVER TITLE
    pdf.add_title(
        "SMART ASSETS",
        "Institutional Luxury Collectible Tokenization, Custody & Co-Ownership"
    )

    # 1. ELEVATOR PITCH
    pdf.add_heading1("1. The 30-Second Elevator Pitch (Your Opening)")
    pdf.add_callout(
        '"SmartAssets is an institutional-grade, decentralized platform designed for physical luxury collectible '
        'tokenization, verifiable Horological custody, multi-tier AI counterfeit detection, and fractional co-ownership. '
        'High-value assets—such as Rolex/Patek Philippe watches, fine art, and rare diamonds—suffer from counterfeit fraud, '
        'illiquid high barriers to entry, and untrusted settlement. SmartAssets bridges this divide by unifying React Native '
        '(Expo SDK 54), Google Gemini Flash multimodal computer vision, Ethereum Sepolia smart contracts, and Supabase '
        'Row-Level Security into an institutional dual-ledger custody network."'
    )

    # 2. WOW FEATURES
    pdf.add_heading1("2. The Essential 'WOW' Features (How They Work & Built)")

    pdf.add_heading2("Feature 1: Passwordless MetaMask Mobile Authentication (EIP-191 / SIWE)")
    pdf.add_paragraph("Allows users to log in or link a cryptographically verified wallet address with zero passwords and zero gas fees.")
    pdf.add_bullet("1. Nonce Challenge", "App calls GET /api/auth/nonce. Backend generates a 16-byte random hex string with a strict 5-minute time-to-live (TTL).")
    pdf.add_bullet("2. Deep-Link Bridge", "App uses @metamask/sdk with a custom return scheme (smartassets://) to trigger MetaMask personal_sign.")
    pdf.add_bullet("3. Gasless Cryptography", "User signs the EIP-191 challenge off-chain. Costs 0 ETH gas and does not write to the blockchain.")
    pdf.add_bullet("4. Signature Verification", "Backend recovers the signer address using ethers.verifyMessage(), burns the nonce to prevent replay attacks, and issues an authentic Supabase JWT session.")
    pdf.add_bullet("Technologies", "React Native Expo 54, @metamask/sdk, ethers.js v6, Supabase Auth Admin API.")

    pdf.add_heading2("Feature 2: Multimodal AI Vision Gatekeeper & Anti-Counterfeit Scanner")
    pdf.add_paragraph("Acts as an automated real-time gatekeeper, analyzing collectible photos to prevent synthetic fakes and catalog fraud.")
    pdf.add_bullet("Tier 1: Pre-flight", "Validates image resolution (>300x300px) and file header byte integrity.")
    pdf.add_bullet("Tier 2: Deepfake Guard", "Analyzes synthetic image artifacts. Rejects uploads with AI-generation probability > 0.82 (Midjourney/DALL-E).")
    pdf.add_bullet("Tier 3: Gemini Flash Vision", "Google Gemini Flash analyzes visual hallmarks, logos, serial numbers, and flags category mismatches.")
    pdf.add_bullet("Tier 4: Market Oracle", "Appraises asset into Floor, Median, and Fair Market Value Bands in ZAR/USD, linking existing ERC-721 records.")
    pdf.add_bullet("Technologies", "Google Gemini Flash API, Sharp/Buffer processing, marketOracleService.js.")

    pdf.new_page()

    pdf.add_heading2("Feature 3: Dual-Ledger On-Chain Escrow Settlement (SmartAssetEscrow.sol)")
    pdf.add_paragraph("Eliminates buyer and seller fraud for high-value transactions through a 9-stage sequential state machine on Ethereum Sepolia.")
    pdf.add_callout("Sequential Lifecycle: None -> PaymentLocked -> InTransit -> InInspection -> Delivered -> Accepted -> ReleasedToSeller")
    pdf.add_bullet("Payment Locked", "Buyer deposits Sepolia ETH into the smart contract; funds are held in trust.")
    pdf.add_bullet("In Transit & Inspection", "Seller ships asset via armored courier (tracking hash logged on-chain); physical custody horologists verify authenticity.")
    pdf.add_bullet("Delivery & Payout", "Buyer inspects physical asset and accepts; contract releases funds to seller and creates ownership in user_holdings.")
    pdf.add_bullet("Dispute Resolution", "Either party can trigger Disputed status; designated multi-sig arbitrators decide refund vs payout.")
    pdf.add_bullet("Technologies", "Solidity ^0.8.24, OpenZeppelin ReentrancyGuard, Ethereum Sepolia, Hardhat.")

    pdf.add_heading2("Feature 4: Fractional Co-Ownership & Real-Time Portfolio Engine")
    pdf.add_paragraph("Splits multi-million Rand collectibles into affordable shares, backed by an atomic time-series valuation engine.")
    pdf.add_bullet("Fractional Positions", "Atomic DB transaction updates asset shares_sold and writes to public.investment_positions.")
    pdf.add_bullet("Time-Series Analytics", "Daily snapshot service aggregates holdings, cash, and escrow balances into public.portfolio_snapshots.")
    pdf.add_bullet("Yield & Trendlines", "Renders interactive ROI yield and portfolio allocation charts over 24h, 7d, 30d, and 1y periods.")
    pdf.add_bullet("Technologies", "investmentPositionService.js, portfolioSnapshotService.js, React Native SVG.")

    pdf.add_heading2("Feature 5: 3D glTF Mesh Generation & AR 'Live Room Preview'")
    pdf.add_paragraph("Converts 2D listing photos into optimized 3D digital twins that users can project into their room using Augmented Reality.")
    pdf.add_bullet("3D Reconstruction", "Tripo AI converts listing photos into raw 3D meshes (500k polygons, ~45MB).")
    pdf.add_bullet("Mesh Decimation", "Backend modelOptimizer.js decimates mesh to ~35,000 triangles and WebP textures (~2.5MB) for 60 FPS mobile AR.")
    pdf.add_bullet("AR Projection", "Expo Camera and orientation sensors overlay the collectible onto physical surfaces.")

    # 3. SECURITY
    pdf.add_heading1("3. System Security Architecture (The 6 Defensive Rings)")
    pdf.add_paragraph("Explain your defensive posture using this 6-ring model to demonstrate institutional rigor:")

    pdf.add_bullet("Ring 1: Network & HTTP", "Helmet.js (CSP, HSTS, X-Frame-Options: DENY) + express-rate-limit to block brute-force password/wallet guessing.")
    pdf.add_bullet("Ring 2: Input Sanitization", "securityMiddleware.js recursively scans request bodies/params against SQLi patterns (Union, tautology, pg_sleep).")
    pdf.add_bullet("Ring 3: Session Security", "JWT token revocation blacklist + InactivityWatcher.js (passive PanResponder resets timer on touch; 30s warning at 4m30s; auto-logout at 5m).")
    pdf.add_bullet("Ring 4: Financial Hardening", "Withdrawal email OTP (crypto.randomInt, strict 120-second TTL, strictly 1 attempt per challenge to prevent brute force, per-user concurrency mutex locks).")
    pdf.add_bullet("Ring 5: KYC & Database RLS", "Institutional 3-Doc KYC (ID, Tax, Proof of Residence) in private buckets with signed URLs; Supabase PostgreSQL Row-Level Security (auth.uid() = user_id).")
    pdf.add_bullet("Ring 6: Smart Contracts", "Solidity ^0.8.24 with native overflow checks + OpenZeppelin ReentrancyGuard (nonReentrant modifier) against recursive drain attacks.")

    pdf.new_page()

    # 4. TECH STACK MATRIX
    pdf.add_heading1("4. Master Technology Stack Summary")
    pdf.add_bullet("Mobile Client", "React Native (Expo SDK 54), React Navigation v7, AsyncStorage, Vector Icons, SVG Charts")
    pdf.add_bullet("Mobile Web3 Provider", "@metamask/sdk, Ethers.js v6, custom deep-linking (smartassets://)")
    pdf.add_bullet("Backend API Gateway", "Node.js, Express.js 4.21, Helmet, Rate Limiter Flexible, Multer")
    pdf.add_bullet("Database & Auth", "Supabase PostgreSQL with Row-Level Security (RLS), PostgREST, JWT sessions")
    pdf.add_bullet("Artificial Intelligence", "Google Gemini Flash Multimodal Vision API, Sharp buffer inspection")
    pdf.add_bullet("Decentralized Settlement", "Solidity ^0.8.24, OpenZeppelin, Hardhat, Ethereum Sepolia Testnet")
    pdf.add_bullet("3D & Spatial Computing", "Tripo 3D AI, @gltf-transform/core, meshoptimizer, Expo Camera, Sensors")
    pdf.add_bullet("Financial & Security", "Node crypto, TLS SMTP Email, PanResponder touch interception")

    # 5. ANTICIPATED JUDGES QUESTIONS
    pdf.add_heading1("5. Anticipated Judges' Questions & Winning Answers")

    pdf.add_qa(
        "Q1: Why do you need blockchain and MetaMask instead of just PostgreSQL?",
        "A regular database is centralized and subject to admin manipulation. High-value collectibles require immutable provenance. An ERC-721 certificate on Ethereum Sepolia permanently engraves ownership and custody milestones on an open ledger. Furthermore, smart contract escrow ensures the platform never holds custody of buyer funds—they are locked in verified Solidity code with ReentrancyGuard and released only upon physical appraisal sign-off."
    )

    pdf.add_qa(
        "Q2: Does MetaMask authentication cost real gas fees?",
        "No! We implemented EIP-191 cryptographic challenge-response authentication. The user signs an off-chain challenge string with their private key. The backend recovers the public key using elliptic curve cryptography (ethers.verifyMessage). It costs zero gas and executes instantaneously."
    )

    pdf.add_qa(
        "Q3: How do you prevent users from uploading AI-generated fake luxury assets?",
        "Our AI Vision Gatekeeper runs a 4-tier inspection pipeline. Tier 2 examines frequency anomalies and image metadata; if synthetic probability from Midjourney or DALL-E exceeds 0.82, it is rejected immediately. Tier 3 uses Google Gemini Flash to inspect hallmarks, engravings, serial number typography, and category alignments against authentic standards."
    )

    pdf.add_qa(
        "Q4: What happens if a user leaves their mobile app open unattended?",
        "We built an Inactivity Watcher utilizing React Native's PanResponder. It captures passive touch gestures across the app. After 4 minutes and 30 seconds of inactivity, it displays a 30-second warning countdown. If no touch occurs, the session tokens are wiped and the user is securely logged out to prevent session hijacking."
    )

    pdf.add_qa(
        "Q5: How does your withdrawal system prevent unauthorized payouts?",
        "Withdrawals require institutional KYC, an approved bank account, and a single-use 6-digit OTP code sent over secure TLS to the account holder's email. The OTP has a strict 120-second lifespan and a single-attempt burn policy—a single incorrect attempt destroys the challenge immediately."
    )

    pdf.save()

if __name__ == "__main__":
    build_presentation_pdf()


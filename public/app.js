// Campaign Call Time Management System
class CampaignCallSystem {
    constructor() {
        this.currentUser = null;
        this.currentClient = null;
        this.currentSession = null;
        this.currentDonor = null;
        
        // Initialize data structures
        this.clients = [];
        this.donors = [];
        this.assignments = {}; // clientId -> [donorIds]
        this.clientDonorData = {}; // clientId-donorId -> { research, notes, outcomes }
        this.callOutcomes = [];
        
        // Call status options
        this.callStatuses = [
            "Not Contacted",
            "No Answer - Left Message", 
            "No Answer - No Message",
            "Spoke - Interested",
            "Spoke - Needs Follow-up", 
            "Spoke - Not Interested",
            "Committed - Amount TBD",
            "Committed - Specific Amount",
            "Contributed",
            "Do Not Call"
        ];
        
        this.init();
    }
    
    init() {
        this.loadData();
        this.setupEventListeners();
        this.showScreen('login-screen');
    }
    
    // Data Management
    loadData() {
        // Load from localStorage or use demo data
        const savedData = localStorage.getItem('campaignCallData');
        if (savedData) {
            const data = JSON.parse(savedData);
            this.clients = data.clients || [];
            this.donors = data.donors || [];
            this.assignments = data.assignments || {};
            this.clientDonorData = data.clientDonorData || {};
            this.callOutcomes = data.callOutcomes || [];
        } else {
            this.loadDemoData();
        }
    }
    
    loadDemoData() {
        // Demo clients
        this.clients = [
            {
                id: "client-senate-2024",
                name: "Martinez for Senate",
                candidate: "Maria Martinez", 
                office: "U.S. Senate",
                contact: "campaign@martinez2024.com",
                created: "2024-01-15"
            },
            {
                id: "client-assembly-45", 
                name: "Thompson Campaign",
                candidate: "David Thompson",
                office: "State Assembly District 45", 
                contact: "info@thompson45.org",
                created: "2024-02-01"
            }
        ];
        
        // Demo donors
        this.donors = [
            {
                id: "donor-001",
                firstName: "Jennifer",
                lastName: "Chen", 
                email: "jchen@techcorp.com",
                phone: "(555) 123-4567",
                company: "TechCorp Solutions",
                city: "San Francisco",
                industry: "Technology",
                capacity: 2500,
                lastGift: "$1,000 (2022)",
                tags: ["Tech Industry", "High Capacity"]
            },
            {
                id: "donor-002", 
                firstName: "Robert",
                lastName: "Williams",
                email: "rwilliams@lawfirm.com", 
                phone: "(555) 234-5678",
                company: "Williams & Associates",
                city: "Sacramento", 
                industry: "Legal Services",
                capacity: 1500,
                lastGift: "$750 (2023)",
                tags: ["Legal", "Recurring Donor"]
            },
            {
                id: "donor-003",
                firstName: "Sarah",
                lastName: "Johnson",
                email: "sarah.johnson@nonprofit.org",
                phone: "(555) 345-6789", 
                company: "Education First Foundation",
                city: "Los Angeles",
                industry: "Non-profit", 
                capacity: 500,
                lastGift: "New Prospect", 
                tags: ["Education", "New Prospect"]
            }
        ];
        
        // Demo assignments
        this.assignments = {
            "client-senate-2024": ["donor-001", "donor-002"],
            "client-assembly-45": ["donor-002", "donor-003"]
        };
        
        this.saveData();
    }
    
    saveData() {
        const data = {
            clients: this.clients,
            donors: this.donors,
            assignments: this.assignments,
            clientDonorData: this.clientDonorData,
            callOutcomes: this.callOutcomes
        };
        localStorage.setItem('campaignCallData', JSON.stringify(data));
    }
    
    // Screen Management
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    }
    
    // Authentication
    showLogin(userType) {
        if (userType === 'manager') {
            this.currentUser = { type: 'manager' };
            this.showManagerDashboard();
        } else {
            this.showModal('client-login-modal');
            this.populateClientSelector();
        }
    }
    
    showManagerDashboard() {
        this.showScreen('manager-screen');
        this.renderClients();
        this.renderDonors();
        this.populateAssignmentClients();
    }
    
    populateClientSelector() {
        const selector = document.getElementById('client-selector');
        selector.innerHTML = '<option value="">Select a client...</option>';
        this.clients.forEach(client => {
            const option = document.createElement('option');
            option.value = client.id;
            option.textContent = `${client.name} (${client.candidate})`;
            selector.appendChild(option);
        });
    }
    
    loginAsClient() {
        const clientId = document.getElementById('client-selector').value;
        if (!clientId) return;
        
        this.currentUser = { type: 'client' };
        this.currentClient = this.clients.find(c => c.id === clientId);
        this.hideModal('client-login-modal');
        this.showClientPortal();
    }
    
    logout() {
        this.currentUser = null;
        this.currentClient = null;
        this.currentSession = null;
        this.showScreen('login-screen');
    }
    
    renderClients() {
        const container = document.getElementById('clients-list');
        container.innerHTML = '';
        
        this.clients.forEach(client => {
            const assignedDonors = this.assignments[client.id] || [];
            const completedCalls = this.getClientCallStats(client.id).completed;
            const totalCalls = assignedDonors.length;
            const completion = totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0;
            
            const clientDiv = document.createElement('div');
            clientDiv.className = 'client-item';
            clientDiv.innerHTML = `
                <div class="client-header">
                    <div>
                        <h4 class="client-name">${client.name}</h4>
                        <p class="client-office">${client.candidate} - ${client.office}</p>
                    </div>
                    <button class="btn btn--sm btn--outline" onclick="app.editClient('${client.id}')">Edit</button>
                </div>
                <div class="client-stats">
                    <div class="stat-item">
                        <div class="stat-value">${assignedDonors.length}</div>
                        <div class="stat-label">Assigned</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${completedCalls}</div>
                        <div class="stat-label">Completed</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${Math.round(completion)}%</div>
                        <div class="stat-label">Complete</div>
                    </div>
                </div>
                <div class="completion-bar">
                    <div class="completion-progress" style="width: ${completion}%"></div>
                </div>
            `;
            container.appendChild(clientDiv);
        });
    }
    
    renderDonors() {
        const container = document.getElementById('donors-list');
        const searchInput = document.getElementById('donor-search');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        
        container.innerHTML = '';
        
        const filteredDonors = this.donors.filter(donor => 
            donor.firstName.toLowerCase().includes(searchTerm) ||
            donor.lastName.toLowerCase().includes(searchTerm) ||
            donor.company.toLowerCase().includes(searchTerm) ||
            donor.industry.toLowerCase().includes(searchTerm)
        );
        
        filteredDonors.forEach(donor => {
            const assignedCount = this.getDonorAssignmentCount(donor.id);
            
            const donorDiv = document.createElement('div');
            donorDiv.className = 'donor-item';
            donorDiv.innerHTML = `
                <div class="donor-info">
                    <div class="donor-name">${donor.firstName} ${donor.lastName}</div>
                    <div class="donor-details">
                        ${donor.company} • ${donor.city} • Capacity: $${donor.capacity?.toLocaleString() || 'N/A'}
                    </div>
                    <div class="donor-tags">
                        ${(donor.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                </div>
                <div class="donor-actions">
                    <span class="status status--info">${assignedCount} assigned</span>
                    <button class="btn btn--sm btn--outline" onclick="app.editDonor('${donor.id}')">Edit</button>
                </div>
            `;
            container.appendChild(donorDiv);
        });
    }
    
    // Client Management
    addClient() {
        const name = document.getElementById('client-name').value;
        const candidate = document.getElementById('candidate-name').value;
        const office = document.getElementById('client-office').value;
        const contact = document.getElementById('client-contact').value;
        
        if (!name || !candidate) return;
        
        const client = {
            id: `client-${Date.now()}`,
            name,
            candidate,
            office,
            contact,
            created: new Date().toISOString().split('T')[0]
        };
        
        this.clients.push(client);
        this.assignments[client.id] = [];
        this.saveData();
        this.hideModal('add-client-modal');
        this.renderClients();
        this.clearForm(['client-name', 'candidate-name', 'client-office', 'client-contact']);
    }
    
    editClient(clientId) {
        // Placeholder for edit functionality
        console.log('Edit client:', clientId);
    }
    
    // Donor Management
    addDonor() {
        const firstName = document.getElementById('donor-first-name').value;
        const lastName = document.getElementById('donor-last-name').value;
        const email = document.getElementById('donor-email').value;
        const phone = document.getElementById('donor-phone').value;
        const company = document.getElementById('donor-company').value;
        const city = document.getElementById('donor-city').value;
        const industry = document.getElementById('donor-industry').value;
        const capacity = parseInt(document.getElementById('donor-capacity').value) || 0;
        const lastGift = document.getElementById('donor-last-gift').value;
        const tags = document.getElementById('donor-tags').value.split(',').map(t => t.trim()).filter(t => t);
        
        if (!firstName || !lastName) return;
        
        const donor = {
            id: `donor-${Date.now()}`,
            firstName,
            lastName,
            email,
            phone,
            company,
            city,
            industry,
            capacity,
            lastGift: lastGift || 'New Prospect',
            tags
        };
        
        this.donors.push(donor);
        this.saveData();
        this.hideModal('add-donor-modal');
        this.renderDonors();
        this.clearForm(['donor-first-name', 'donor-last-name', 'donor-email', 'donor-phone', 'donor-company', 'donor-city', 'donor-industry', 'donor-capacity', 'donor-last-gift', 'donor-tags']);
    }
    
    editDonor(donorId) {
        // Placeholder for edit functionality
        console.log('Edit donor:', donorId);
    }
    
    // Assignment Management
    populateAssignmentClients() {
        const selector = document.getElementById('assignment-client');
        selector.innerHTML = '<option value="">Select Client</option>';
        this.clients.forEach(client => {
            const option = document.createElement('option');
            option.value = client.id;
            option.textContent = client.name;
            selector.appendChild(option);
        });
    }
    
    showAssignmentInterface() {
        const clientId = document.getElementById('assignment-client').value;
        if (!clientId) return;
        
        const interface = document.getElementById('assignment-interface');
        interface.classList.remove('hidden');
        
        const client = this.clients.find(c => c.id === clientId);
        const assignedDonors = this.assignments[clientId] || [];
        const unassignedDonors = this.donors.filter(d => !assignedDonors.includes(d.id));
        
        interface.innerHTML = `
            <h4>Managing assignments for ${client.name}</h4>
            <div class="assignment-grid">
                <div class="assignment-column">
                    <div class="column-header">Available Donors</div>
                    <div class="assignment-list" id="unassigned-donors">
                        ${unassignedDonors.map(donor => `
                            <div class="assignable-donor" data-donor-id="${donor.id}" onclick="app.assignDonor('${clientId}', '${donor.id}')">
                                <div class="donor-name">${donor.firstName} ${donor.lastName}</div>
                                <div class="donor-details">${donor.company}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="assignment-column">
                    <div class="column-header">Assigned to ${client.name}</div>
                    <div class="assignment-list" id="assigned-donors">
                        ${assignedDonors.map(donorId => {
                            const donor = this.donors.find(d => d.id === donorId);
                            return `
                                <div class="assignable-donor assigned" data-donor-id="${donor.id}" onclick="app.unassignDonor('${clientId}', '${donor.id}')">
                                    <div class="donor-name">${donor.firstName} ${donor.lastName}</div>
                                    <div class="donor-details">${donor.company}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    
    assignDonor(clientId, donorId) {
        if (!this.assignments[clientId]) {
            this.assignments[clientId] = [];
        }
        if (!this.assignments[clientId].includes(donorId)) {
            this.assignments[clientId].push(donorId);
            this.saveData();
            this.showAssignmentInterface();
            this.renderClients();
        }
    }
    
    unassignDonor(clientId, donorId) {
        if (this.assignments[clientId]) {
            this.assignments[clientId] = this.assignments[clientId].filter(id => id !== donorId);
            this.saveData();
            this.showAssignmentInterface();
            this.renderClients();
        }
    }
    
    // Client Portal
    showClientPortal() {
        this.showScreen('client-screen');
        document.getElementById('client-title').textContent = this.currentClient.name;
        this.updateClientStats();
        this.renderCallQueue();
        this.populateCallStatuses();
        this.setupQueueFilter();
    }
    
    updateClientStats() {
        const stats = this.getClientCallStats(this.currentClient.id);
        const statsEl = document.getElementById('client-stats');
        statsEl.textContent = `${stats.completed}/${stats.total} calls completed`;
    }
    
    renderCallQueue() {
        const container = document.getElementById('call-queue');
        const filterSelect = document.getElementById('queue-filter');
        const filter = filterSelect ? filterSelect.value : 'all';
        
        container.innerHTML = '';
        
        const assignedDonors = this.assignments[this.currentClient.id] || [];
        const donors = assignedDonors.map(id => this.donors.find(d => d.id === id)).filter(d => d);
        
        const filteredDonors = donors.filter(donor => {
            const status = this.getDonorCallStatus(this.currentClient.id, donor.id);
            switch (filter) {
                case 'not-contacted': return status === 'Not Contacted';
                case 'follow-up': return status === 'Spoke - Needs Follow-up';
                case 'interested': return status === 'Spoke - Interested';
                default: return true;
            }
        });
        
        filteredDonors.forEach(donor => {
            const status = this.getDonorCallStatus(this.currentClient.id, donor.id);
            const isCompleted = !['Not Contacted', 'No Answer - Left Message', 'No Answer - No Message'].includes(status);
            
            const queueDiv = document.createElement('div');
            queueDiv.className = `queue-item ${isCompleted ? 'completed' : ''}`;
            queueDiv.onclick = () => this.showDonorDetails(donor.id);
            
            queueDiv.innerHTML = `
                <div class="queue-donor-info">
                    <div class="queue-donor-name">${donor.firstName} ${donor.lastName}</div>
                    <div class="queue-donor-details">
                        ${donor.company} • ${donor.phone} • Capacity: $${donor.capacity?.toLocaleString() || 'N/A'}
                    </div>
                </div>
                <div class="queue-status">
                    <span class="status ${this.getStatusClass(status)}">${status}</span>
                </div>
            `;
            
            container.appendChild(queueDiv);
        });
    }
    
    showDonorDetails(donorId) {
        const donor = this.donors.find(d => d.id === donorId);
        if (!donor) return;
        
        const detailsCard = document.getElementById('donor-details');
        const infoContainer = document.getElementById('donor-info');
        
        // Get client-specific data
        const dataKey = `${this.currentClient.id}-${donorId}`;
        const clientData = this.clientDonorData[dataKey] || {};
        const currentStatus = this.getDonorCallStatus(this.currentClient.id, donorId);
        
        infoContainer.innerHTML = `
            <div class="donor-info-grid">
                <div class="info-item">
                    <div class="info-label">Full Name</div>
                    <div class="info-value">${donor.firstName} ${donor.lastName}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Phone</div>
                    <div class="info-value">${donor.phone}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Email</div>
                    <div class="info-value">${donor.email}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Company</div>
                    <div class="info-value">${donor.company}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">City</div>
                    <div class="info-value">${donor.city}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Industry</div>
                    <div class="info-value">${donor.industry}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Capacity</div>
                    <div class="info-value">$${donor.capacity?.toLocaleString() || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Last Gift</div>
                    <div class="info-value">${donor.lastGift}</div>
                </div>
            </div>
            <div class="info-item">
                <div class="info-label">Tags</div>
                <div class="info-value">
                    ${(donor.tags || []).map(tag => `<span class="tag">${tag}</span>`).join(' ')}
                </div>
            </div>
        `;
        
        // Pre-populate form with current data
        document.getElementById('call-status').value = currentStatus;
        document.getElementById('ask-amount').value = clientData.askAmount || '';
        document.getElementById('committed-amount').value = clientData.committedAmount || '';
        document.getElementById('call-notes').value = clientData.notes || '';
        document.getElementById('followup-date').value = clientData.followupDate || '';
        
        // Store current donor ID for form submission
        this.currentDonor = donorId;
        
        detailsCard.classList.remove('hidden');
    }
    
    closeDonorDetails() {
        document.getElementById('donor-details').classList.add('hidden');
        this.currentDonor = null;
    }
    
    recordCallOutcome() {
        if (!this.currentDonor) return;
        
        const status = document.getElementById('call-status').value;
        const askAmount = document.getElementById('ask-amount').value;
        const committedAmount = document.getElementById('committed-amount').value;
        const notes = document.getElementById('call-notes').value;
        const followupDate = document.getElementById('followup-date').value;
        
        if (!status) return;
        
        const dataKey = `${this.currentClient.id}-${this.currentDonor}`;
        this.clientDonorData[dataKey] = {
            status,
            askAmount: askAmount ? parseInt(askAmount) : null,
            committedAmount: committedAmount ? parseInt(committedAmount) : null,
            notes,
            followupDate,
            lastUpdate: new Date().toISOString(),
            clientId: this.currentClient.id
        };
        
        // Record call outcome in history
        this.callOutcomes.push({
            id: `outcome-${Date.now()}`,
            clientId: this.currentClient.id,
            donorId: this.currentDonor,
            status,
            askAmount: askAmount ? parseInt(askAmount) : null,
            committedAmount: committedAmount ? parseInt(committedAmount) : null,
            notes,
            followupDate,
            timestamp: new Date().toISOString()
        });
        
        this.saveData();
        this.closeDonorDetails();
        this.renderCallQueue();
        this.updateClientStats();
        
        // Clear form
        this.clearForm(['call-status', 'ask-amount', 'committed-amount', 'call-notes', 'followup-date']);
    }
    
    // Utility Functions
    getDonorCallStatus(clientId, donorId) {
        const dataKey = `${clientId}-${donorId}`;
        const clientData = this.clientDonorData[dataKey];
        return clientData?.status || 'Not Contacted';
    }
    
    getClientCallStats(clientId) {
        const assignedDonors = this.assignments[clientId] || [];
        const completed = assignedDonors.filter(donorId => {
            const status = this.getDonorCallStatus(clientId, donorId);
            return !['Not Contacted', 'No Answer - Left Message', 'No Answer - No Message'].includes(status);
        }).length;
        
        return {
            total: assignedDonors.length,
            completed,
            percentage: assignedDonors.length > 0 ? Math.round((completed / assignedDonors.length) * 100) : 0
        };
    }
    
    getDonorAssignmentCount(donorId) {
        return Object.values(this.assignments).filter(assignments => 
            assignments.includes(donorId)
        ).length;
    }
    
    getStatusClass(status) {
        if (['Contributed', 'Committed - Specific Amount'].includes(status)) return 'status--success';
        if (['Spoke - Not Interested', 'Do Not Call'].includes(status)) return 'status--error';
        if (['Spoke - Needs Follow-up', 'Committed - Amount TBD'].includes(status)) return 'status--warning';
        return 'status--info';
    }
    
    populateCallStatuses() {
        const statusSelect = document.getElementById('call-status');
        statusSelect.innerHTML = '<option value="">Select outcome...</option>';
        this.callStatuses.forEach(status => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = status;
            statusSelect.appendChild(option);
        });
    }
    
    setupQueueFilter() {
        const filterSelect = document.getElementById('queue-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', () => {
                this.renderCallQueue();
            });
        }
    }
    
    setupEventListeners() {
        // Wait for DOM to be ready, then set up search
        document.addEventListener('DOMContentLoaded', () => {
            this.setupSearchListeners();
        });
        
        // If DOM is already ready, set up immediately
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupSearchListeners();
            });
        } else {
            this.setupSearchListeners();
        }
        
        // Modal close on background click
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.classList.add('hidden');
            }
        });
    }
    
    setupSearchListeners() {
        const searchInput = document.getElementById('donor-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => this.renderDonors());
        }
    }
    
    // Modal Management
    showModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    }
    
    hideModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }
    
    clearForm(fieldIds) {
        fieldIds.forEach(id => {
            const field = document.getElementById(id);
            if (field) {
                if (field.type === 'checkbox') {
                    field.checked = false;
                } else {
                    field.value = '';
                }
            }
        });
    }
    
    // Session Management
    startCallSession() {
        this.currentSession = {
            startTime: new Date(),
            callsCompleted: 0
        };
        // Could add session timer, goals, etc.
    }
}

// Initialize the application
const app = new CampaignCallSystem();
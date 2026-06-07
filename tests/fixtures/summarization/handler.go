package handlers

import (
	"fmt"
	"net/http"
	"time"
)

// User represents a user model
type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UserStore defines user storage interface
type UserStore interface {
	Create(user *User) error
	GetByID(id string) (*User, error)
	Update(user *User) error
	Delete(id string) error
}

// UserHandler handles user-related HTTP requests
type UserHandler struct {
	store UserStore
}

// NewUserHandler creates new user handler
func NewUserHandler(store UserStore) *UserHandler {
	return &UserHandler{store: store}
}

// CreateUser handles POST /users
func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var user User
	if err := parseJSON(r, &user); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	user.ID = generateID()
	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()

	if err := h.store.Create(&user); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	respondJSON(w, user, http.StatusCreated)
}

// GetUser handles GET /users/{id}
func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := extractUserID(r)
	user, err := h.store.GetByID(id)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	respondJSON(w, user, http.StatusOK)
}

// UpdateUser handles PUT /users/{id}
func (h *UserHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := extractUserID(r)
	var updates map[string]interface{}
	if err := parseJSON(r, &updates); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	user, err := h.store.GetByID(id)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	applyUpdates(user, updates)
	user.UpdatedAt = time.Now()

	if err := h.store.Update(user); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	respondJSON(w, user, http.StatusOK)
}

// DeleteUser handles DELETE /users/{id}
func (h *UserHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := extractUserID(r)
	if err := h.store.Delete(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Helper functions

func generateID() string {
	return fmt.Sprintf("user_%d", time.Now().UnixNano())
}

func extractUserID(r *http.Request) string {
	return r.URL.Query().Get("id")
}

func parseJSON(r *http.Request, v interface{}) error {
	// Implementation
	return nil
}

func respondJSON(w http.ResponseWriter, v interface{}, status int) {
	w.WriteHeader(status)
	// Implementation
}

func applyUpdates(user *User, updates map[string]interface{}) {
	// Implementation
}

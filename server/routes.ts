import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import * as crypto from "crypto";
import { setupAuth, hashPassword } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import { 
  generateAIResponse, 
  analyzeSentiment, 
  generateWeeklySummary, 
  generateCustomPrompts, 
  storeEmbedding,
  generateJournalTitle
} from "./openai";
import {
  processSingleEntry,
  processAllEntriesForUser,
  processAllEntries
} from "./ai-suggestion-module";
import { journalEntries } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import oauthSettingsRoutes from "./routes/oauth-settings";
import openaiSettingsRoutes from "./routes/openai-settings";
import adminStatsRoutes from "./routes/admin-stats";
import subscriptionRoutes from "./routes/subscription";
import paypalSettingsRoutes from "./routes/paypal-settings";
import { setupHabitRoutes } from "./routes/habits";
import { setupTaskRoutes } from "./routes/tasks";
import { registerAvatarRoutes } from "./routes/avatar";
import { User } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication routes
  await setupAuth(app);
  
  // Setup task and habit routes
  setupTaskRoutes(app);
  setupHabitRoutes(app);

  // User API
  app.get("/api/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.id);
    if (req.user?.id !== userId && !req.user?.isAdmin) return res.sendStatus(403);
    
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Don't send the password back to the client
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });
  
  app.patch("/api/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.id);
    if (req.user?.id !== userId && !req.user?.isAdmin) return res.sendStatus(403);
    
    try {
      // Only allow certain fields to be updated
      const allowedFields = [
        'firstName', 'lastName', 'name', 'displayName', 'email', 'avatar', 
        'pronouns', 'dateOfBirth', 'location', 'bio', 'hobbies', 'interests'
      ];
      const updateData: Partial<User> = {};
      
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          // Use type assertion to handle dynamic field assignment
          (updateData as any)[field] = req.body[field];
        }
      }
      
      // Check if the email is being updated
      if (updateData.email && updateData.email !== req.user.email) {
        // If email is changed, user needs to be re-verified
        updateData.isVerified = false;
        // Generate new verification token
        updateData.verificationToken = crypto.randomBytes(20).toString('hex');
        
        // Send verification email
        // This will be implemented later
      }
      
      const updatedUser = await storage.updateUser(userId, updateData);
      
      // Don't send password back
      const { password, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });
  
  // Email verification
  app.get("/api/verify-email/:token", async (req, res) => {
    try {
      const token = req.params.token;
      
      // Find user with this token
      const users = await storage.getAllUsers();
      const user = users.find(u => u.verificationToken === token);
      
      if (!user) {
        return res.status(400).json({ error: "Invalid verification token" });
      }
      
      // Update user to verified status
      await storage.verifyUser(user.id);
      
      // Redirect to login page with success message
      res.redirect('/#/auth?verified=true');
    } catch (error) {
      console.error("Error verifying email:", error);
      res.status(500).json({ error: "Failed to verify email" });
    }
  });
  
  // Forgot password
  app.post("/api/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      
      // Find user by email
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Don't reveal that the user doesn't exist
        return res.status(200).json({ message: "If the email exists, a reset link has been sent" });
      }
      
      // Generate reset token and expiry
      const resetToken = crypto.randomBytes(20).toString('hex');
      const resetExpiry = new Date();
      resetExpiry.setHours(resetExpiry.getHours() + 1); // Token valid for 1 hour
      
      // Update user with reset token and expiry
      await storage.updateUser(user.id, {
        resetPasswordToken: resetToken,
        resetPasswordExpires: resetExpiry.toISOString()
      });
      
      // Send password reset email
      // This will be implemented later
      
      res.status(200).json({ message: "If the email exists, a reset link has been sent" });
    } catch (error) {
      console.error("Error processing forgot password:", error);
      res.status(500).json({ error: "Failed to process forgot password request" });
    }
  });
  
  // Reset password
  app.post("/api/reset-password/:token", async (req, res) => {
    try {
      const { password } = req.body;
      const token = req.params.token;
      
      if (!password) {
        return res.status(400).json({ error: "Password is required" });
      }
      
      // Find user with this token and ensure it's not expired
      const users = await storage.getAllUsers();
      const now = new Date();
      
      const user = users.find(u => 
        u.resetPasswordToken === token && 
        u.resetPasswordExpires && 
        new Date(u.resetPasswordExpires) > now
      );
      
      if (!user) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }
      
      // Hash the new password
      const hashedPassword = await hashPassword(password);
      
      // Update user with new password and clear the reset token
      await storage.updateUser(user.id, {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null
      });
      
      res.status(200).json({ message: "Password has been reset successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Journal Entries API
  app.get("/api/journal-entries/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const entries = await storage.getJournalEntriesByUserId(userId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch journal entries" });
    }
  });
  
  // Get a single journal entry by ID
  app.get("/api/journal-entries/entry/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const id = Number(req.params.id);
    
    try {
      const entry = await storage.getJournalEntryById(id);
      
      if (!entry) {
        return res.status(404).json({ error: "Journal entry not found" });
      }
      
      // Check if the entry belongs to the authenticated user
      if (entry.userId !== req.user?.id) {
        return res.sendStatus(403);
      }
      
      res.json(entry);
    } catch (error) {
      console.error("Error fetching journal entry:", error);
      res.status(500).json({ error: "Failed to fetch journal entry" });
    }
  });
  
  // Save Chat Transcript - collects all chat messages and saves them as a single journal entry
  app.post("/api/journal-entries/save-chat", async (req, res) => {
    console.log(`⭐ POST /api/journal-entries/save-chat authentication check - isAuthenticated: ${req.isAuthenticated()}`);
    if (!req.isAuthenticated()) {
      console.log(`❌ POST /api/journal-entries/save-chat failed authentication check`);
      return res.sendStatus(401);
    }
    
    const { userId, date = null, timezone = null } = req.body;
    console.log(`⭐ POST /api/journal-entries/save-chat user check - req.user.id: ${req.user?.id}, userId: ${userId}`);
    if (req.user?.id !== userId) {
      console.log(`❌ POST /api/journal-entries/save-chat failed user ID check - req.user.id: ${req.user?.id}, userId: ${userId}`);
      return res.sendStatus(403);
    }
    
    console.log(`⭐ POST /api/journal-entries/save-chat received for user ${userId}`);
    
    try {
      // Get recent chat entries that aren't already part of a saved journal
      console.log(`Fetching recent entries for user ${userId}`);
      const recentEntries = await storage.getRecentJournalEntriesByUserId(userId, 50);
      const chatEntries = recentEntries.filter(entry => !entry.isJournal);
      
      console.log(`Found ${chatEntries.length} chat entries to save`);
      
      if (chatEntries.length === 0) {
        return res.status(400).json({ error: "No chat entries to save" });
      }
      
      // Combine all entries into a transcript
      const transcript = chatEntries
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(entry => `${entry.isAiResponse ? 'Hope Log: ' : 'You: '}${entry.content}`)
        .join('\n\n');
      
      // Use the last user message as content
      const userMessages = chatEntries.filter(entry => !entry.isAiResponse);
      const content = userMessages.length > 0 
        ? userMessages[userMessages.length - 1].content 
        : "Chat transcript";
      
      console.log(`Generated transcript with ${transcript.length} characters`);
      
      // Generate meaningful title for the chat journal entry
      let title;
      try {
        title = await generateJournalTitle(transcript);
        console.log(`Generated title for chat transcript: ${title}`);
      } catch (titleError) {
        console.error("Failed to generate title for chat, using default:", titleError);
        title = "Chat Transcript";
      }
      
      // Generate summary and analyze sentiment with goal extraction
      let sentiment: any = { score: 0, emotions: [], themes: [], goals: [], tasks: [] };
      try {
        console.log(`Analyzing sentiment for chat transcript`);
        sentiment = await analyzeSentiment(transcript);
        console.log(`✅ Sentiment analysis complete for chat transcript`);
      } catch (sentimentError) {
        console.error("Error analyzing sentiment:", sentimentError);
        // Default sentiment already set
      }
      
      // Use provided date if available, otherwise use current time
      // The client should provide the date in the user's local timezone
      let entryDate;
      if (date) {
        console.log(`Using provided date: ${date}`);
        entryDate = date; // Use directly as string
      } else {
        entryDate = new Date().toISOString();
        console.log(`No date provided, using current date: ${entryDate}`);
      }
      
      console.log(`Creating journal entry from chat with date: ${entryDate}`);
      
      // Create the journal entry as a permanent record (isJournal=true)
      let journalEntry;
      try {
        journalEntry = await storage.createJournalEntry({
          userId,
          content: content,
          title: title,
          date: entryDate,
          isAiResponse: false,
          isJournal: true,
          transcript: transcript, // Store the full conversation transcript
          analyzed: false // Mark for processing by AI suggestion module
        });
        console.log(`✅ Chat journal entry created with ID: ${journalEntry.id}`);
      } catch (createError) {
        console.error(`❌ Error creating journal entry from chat:`, createError);
        return res.status(500).json({ error: "Failed to create journal entry from chat" });
      }
      
      // Update with sentiment analysis
      const updatedEntry = await storage.updateJournalEntrySentiment(
        journalEntry.id, 
        sentiment
      );
      
      // Extract and process any goals
      if (sentiment.goals && sentiment.goals.length > 0) {
        for (const goal of sentiment.goals) {
          if (goal.isNew) {
            // Create a new goal
            await storage.createGoal({
              userId,
              name: goal.name,
              target: 100, // Default target
              progress: 0,
              unit: "%",
              colorScheme: 1
            });
          } else if (goal.completion !== undefined) {
            // Find the existing goal to update
            const existingGoals = await storage.getGoalsByUserId(userId);
            const matchingGoal = existingGoals.find(g => 
              g.name.toLowerCase() === goal.name.toLowerCase()
            );
            
            if (matchingGoal) {
              // Update the goal progress
              await storage.updateGoalProgress(matchingGoal.id, goal.completion);
            }
          }
        }
      }
      
      // Store embedding for RAG
      await storeEmbedding(journalEntry.id, transcript);
      
      // Process with the unified AI suggestion module to generate AI suggestions
      try {
        // Process in the background - don't wait for it to complete
        // This will save suggestions to the ai_goals, ai_tasks, ai_habits tables
        processSingleEntry(journalEntry).catch(error => {
          console.error(`Background AI suggestion processing for chat entry ${journalEntry.id} failed:`, error);
        });
        
        console.log(`Started background AI suggestion processing for chat entry ${journalEntry.id} using new AI tables`);
      } catch (suggestError) {
        console.error("Error initiating AI suggestion processing for chat:", suggestError);
        // This shouldn't fail the whole request
        // Still mark as analyzed to avoid repeated processing attempts
        await storage.updateJournalEntry(journalEntry.id, { analyzed: true });
      }
      
      // Delete individual chat entries to clear the chat
      // This is necessary to avoid storing individual messages as separate journal entries
      for (const entry of chatEntries) {
        await storage.deleteJournalEntry(entry.id);
      }
      
      res.status(201).json(updatedEntry);
    } catch (error) {
      console.error("Error saving chat transcript:", error);
      res.status(500).json({ error: "Failed to save chat transcript" });
    }
  });

  // Endpoint for getting AI chat responses without saving to DB
  app.post("/api/chat-response", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const { content, userId, history = [] } = req.body;
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      // Convert history to the format expected by the OpenAI function
      const conversationHistory = history.map((entry: {role: string, content: string}) => ({
        role: entry.role as "user" | "ai",
        content: entry.content
      }));
      
      let aiResponse;
      
      // Check for special prompt types
      if (content.startsWith('__MULTI_PART_PROMPT__:')) {
        // This is a multi-part prompt from the Journal Prompts section
        // Extract the actual prompt from the prefix
        const promptContent = content.replace('__MULTI_PART_PROMPT__:', '').trim();
        console.log("Server received multi-part prompt:", promptContent);
        
        // Create a special system message for multi-part prompts
        const systemMessage = {
          role: "system" as "system", 
          content: `You are helping the user with a multi-part journaling prompt: "${promptContent}". 
          
This is not a simple question but a structured journaling exercise that requires detailed, reflective responses.

For this exercise:
1. Break down the prompt into individual questions or parts
2. Ask the user about each part ONE AT A TIME, waiting for their response before moving to the next part
3. If the prompt requires listing multiple items (like "three things that went well"), ask about each item separately
4. Encourage deep reflection by asking follow-up questions about WHY or HOW
5. After the user has completed all parts, provide a brief summary of their responses
6. Your tone should be warm, supportive and encouraging
          
Example of good breakdown for "What are three things that went well today and why?":
- First ask: "Let's reflect on your day. What's one thing that went well today?"
- After they respond, ask: "That's wonderful. And why do you think that particular thing went well?"
- Then: "Great reflection. What's a second thing that went well today?"
- And so on until all three items and their "why" explanations are explored.`
        };
        
        // Add the system message to guide the AI's response strategy
        const enhancedHistory = [systemMessage, ...conversationHistory];
        
        // Generate the special AI response for multi-part prompts
        aiResponse = await generateAIResponse(
          promptContent, 
          enhancedHistory, 
          req.user.username || "User", 
          userId,
          true // Flag that this is a multi-part prompt
        );
      } 
      // Check if this is a direct one-shot prompt from suggested prompts
      else if (content.startsWith('ASK_ME_ABOUT:')) {
        // Remove the prefix to get the clean prompt
        const promptContent = content.replace('ASK_ME_ABOUT:', '').trim();
        console.log("Server received direct prompt:", promptContent);
        
        // Create a special system message that tells the AI to ask the user about this topic
        const systemMessage = {
          role: "system" as "system",
          content: `You are a warm and empathetic journaling assistant. The user has selected a journaling topic: "${promptContent}".
          
IMPORTANT: Instead of answering this as if the user asked YOU this question, you need to turn this into a question FOR the user.

For example:
- If the topic is "How am I feeling today?" → Ask the user "How are you feeling today? I'd love to hear about your current emotions."
- If the topic is "What's something I'm grateful for?" → Ask "What's something you're feeling grateful for today? It can be something small or significant."

Your role is to:
1. Turn the topic into an engaging question directed TO the user
2. Make your question open-ended and inviting
3. Sound warm, caring and genuinely interested
4. Keep your response brief (1-2 sentences)
5. Avoid answering the question yourself or making assumptions`
        };
        
        // Create a conversation history with just our system message
        const specialHistory = [systemMessage];
        
        // Generate a response that will be a question to the user about the topic
        aiResponse = await generateAIResponse(
          promptContent,
          specialHistory,
          req.user.username || "User",
          userId,
          false
        );
      } 
      // Regular conversation
      else {
        // Normal conversation handling
        aiResponse = await generateAIResponse(content, conversationHistory, req.user.username || "User", userId);
      }
      
      // Return only the AI response
      res.status(200).json({ content: aiResponse });
    } catch (error) {
      console.error("Error generating AI response:", error);
      res.status(500).json({ error: "Failed to generate AI response" });
    }
  });

  // Delete a journal entry
  app.delete("/api/journal-entries/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const entryId = Number(req.params.id);
    
    try {
      // Get the entry before deleting to verify it exists and belongs to the user
      const entry = await storage.getJournalEntryById(entryId);
      
      if (!entry) {
        return res.status(404).json({ error: "Journal entry not found" });
      }
      
      // Ensure the entry belongs to the authenticated user
      if (entry.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to delete this entry" });
      }
      
      await storage.deleteJournalEntry(entryId);
      res.status(200).json({ message: "Journal entry deleted successfully" });
    } catch (error) {
      console.error("Error deleting journal entry:", error);
      res.status(500).json({ error: "Failed to delete journal entry" });
    }
  });
  
  // Get deleted journal entries (recycle bin)
  app.get("/api/journal-entries/:userId/deleted", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const entries = await storage.getDeletedJournalEntriesByUserId(userId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching deleted journal entries:", error);
      res.status(500).json({ error: "Failed to fetch deleted journal entries" });
    }
  });
  
  // Restore journal entry from recycle bin
  app.post("/api/journal-entries/:id/restore", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const entryId = Number(req.params.id);
    
    try {
      // Get the entry before restoring to verify it exists and belongs to the user
      const entry = await storage.getJournalEntryById(entryId);
      
      if (!entry) {
        return res.status(404).json({ error: "Journal entry not found" });
      }
      
      // Ensure the entry belongs to the authenticated user
      if (entry.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to restore this entry" });
      }
      
      const restoredEntry = await storage.restoreJournalEntry(entryId);
      res.json(restoredEntry);
    } catch (error) {
      console.error("Error restoring journal entry:", error);
      res.status(500).json({ error: "Failed to restore journal entry" });
    }
  });
  
  // Permanently delete journal entry from recycle bin
  app.delete("/api/journal-entries/:id/permanent", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const entryId = Number(req.params.id);
    
    try {
      // Get the entry before permanently deleting to verify it exists and belongs to the user
      const entry = await storage.getJournalEntryById(entryId);
      
      if (!entry) {
        return res.status(404).json({ error: "Journal entry not found" });
      }
      
      // Ensure the entry belongs to the authenticated user
      if (entry.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to delete this entry" });
      }
      
      await storage.permanentlyDeleteJournalEntry(entryId);
      res.status(200).json({ message: "Journal entry permanently deleted" });
    } catch (error) {
      console.error("Error permanently deleting journal entry:", error);
      res.status(500).json({ error: "Failed to permanently delete journal entry" });
    }
  });

  app.post("/api/journal-entries", async (req, res) => {
    console.log(`⭐ POST /api/journal-entries authentication check - isAuthenticated: ${req.isAuthenticated()}`);
    if (!req.isAuthenticated()) {
      console.log(`❌ POST /api/journal-entries failed authentication check`);
      return res.sendStatus(401);
    }
    
    const { content, userId, transcript = null, date = null } = req.body;
    console.log(`⭐ POST /api/journal-entries user check - req.user.id: ${req.user?.id}, userId: ${userId}`);
    if (req.user?.id !== userId) {
      console.log(`❌ POST /api/journal-entries failed user ID check - req.user.id: ${req.user?.id}, userId: ${userId}`);
      return res.sendStatus(403);
    }
    
    console.log(`⭐ POST /api/journal-entries received for user ${userId} with content length ${content?.length || 0}`);
    
    try {
      // Validate content exists
      if (!content || content.trim() === '') {
        console.error("Missing content in journal entry");
        return res.status(400).json({ error: "Content is required for journal entries" });
      }

      // This endpoint now only handles direct journal entries
      // Chat messages are handled in memory and only saved when "Save Chat" is clicked
      
      // EMERGENCY FIX: Use the date string from client directly 
      // The client is now providing a specially formatted date string that must be preserved exactly
      let entryDate: string;
      
      if (date) {
        // Log but otherwise use the client-provided date string directly
        console.log(`🚨 Server received force-formatted date: ${date}`);
        entryDate = date; // Use it directly without further parsing
      } else {
        // Only for fallback - construct a current date in ISO format
        entryDate = new Date().toISOString();
        console.log(`⚠️ No date provided, using current date: ${entryDate}`);
      }
      
      // Generate a meaningful title for the journal entry
      let title;
      try {
        title = await generateJournalTitle(content);
        console.log(`Generated title for journal entry: ${title}`);
      } catch (titleError) {
        console.error("Failed to generate title, using default:", titleError);
        title = "Journal Entry";
      }

      console.log(`Creating journal entry with title: "${title}" for user ${userId}`);
      
      // Save as permanent journal entry
      let journalEntry;
      try {
        journalEntry = await storage.createJournalEntry({
          userId,
          content,
          date: entryDate, // Already an ISO string from client
          title, // Add the AI-generated title
          isAiResponse: false,
          isJournal: true, // This is a permanent journal entry
          transcript: transcript || content, // Use provided transcript if available, otherwise use content
          analyzed: false // Mark for processing by the unified AI suggestion module
        });
        console.log(`✅ Journal entry created with ID: ${journalEntry.id}`);
      } catch (createError) {
        console.error(`❌ Error creating journal entry:`, createError);
        return res.status(500).json({ error: "Failed to create journal entry" });
      }
      
      // Get sentiment analysis
      let sentiment: any = { score: 0, emotions: [], themes: [], goals: [], tasks: [] };
      try {
        console.log(`Getting sentiment analysis for entry ID: ${journalEntry.id}`);
        sentiment = await analyzeSentiment(content);
        await storage.updateJournalEntrySentiment(journalEntry.id, sentiment);
        console.log(`✅ Updated sentiment for entry ID: ${journalEntry.id}`);
      } catch (sentimentError) {
        console.error(`❌ Error analyzing sentiment for entry ${journalEntry.id}:`, sentimentError);
        // Continue with the process - sentiment analysis is not critical
      }
      
      // Process with the unified AI suggestion module to generate AI suggestions
      try {
        // Process journal entries if they are substantial
        if (content.length > 100) {
          // Process in the background - don't wait for it to complete
          // This will now save suggestions to the ai_goals, ai_tasks, ai_habits tables
          processSingleEntry(journalEntry).catch(error => {
            console.error(`Background AI suggestion processing for entry ${journalEntry.id} failed:`, error);
          });
          
          console.log(`Started background AI suggestion processing for entry ${journalEntry.id} using new AI tables`);
        } else {
          console.log(`Journal entry ${journalEntry.id} too short for AI suggestion processing (${content.length} chars)`);
          // Still mark as analyzed to avoid processing it later
          await storage.updateJournalEntry(journalEntry.id, { analyzed: true });
        }
      } catch (suggestError) {
        console.error("Error initiating AI suggestion processing:", suggestError);
        // This shouldn't fail the whole request
        // Still mark as analyzed to avoid repeated processing attempts
        await storage.updateJournalEntry(journalEntry.id, { analyzed: true });
      }
      
      // Process goal progress updates if needed
      if (sentiment && sentiment.goals && sentiment.goals.length > 0) {
        console.log(`Processing ${sentiment.goals.length} goals from sentiment analysis`);
        for (const goal of sentiment.goals) {
          try {
            if (goal.completion !== undefined) {
              // Find the existing goal to update
              const existingGoals = await storage.getGoalsByUserId(userId);
              const matchingGoal = existingGoals.find(g => 
                g.name.toLowerCase() === goal.name.toLowerCase()
              );
              
              if (matchingGoal) {
                // Update the goal progress
                await storage.updateGoalProgress(matchingGoal.id, goal.completion);
                console.log(`Updated progress for goal "${goal.name}" to ${goal.completion}%`);
              }
            }
          } catch (goalError) {
            console.error(`Error processing goal "${goal.name}":`, goalError);
          }
        }
      } else {
        console.log(`No goals found in sentiment analysis`);
      }
      
      // Store embedding for RAG functionality
      try {
        await storeEmbedding(journalEntry.id, content);
        console.log(`✅ Stored embedding for journal entry ${journalEntry.id}`);
      } catch (embeddingError) {
        console.error("Failed to store embedding, but continuing:", embeddingError);
      }
      
      // Return the journal entry
      try {
        console.log(`✅ Successfully created journal entry with ID: ${journalEntry.id}`);
        res.status(201).json([journalEntry]);
      } catch (responseError) {
        console.error(`Error sending response:`, responseError);
        res.status(500).json({ error: "Error sending journal entry response" });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to process journal entry" });
    }
  });

  // Moods API
  app.get("/api/moods/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const moods = await storage.getMoodsByUserId(userId);
      res.json(moods);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch moods" });
    }
  });

  app.post("/api/moods", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const { userId, rating, date } = req.body;
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const mood = await storage.createMood({
        userId,
        rating,
        date
      });
      res.status(201).json(mood);
    } catch (error) {
      res.status(500).json({ error: "Failed to record mood" });
    }
  });

  // Goals API
  app.get("/api/goals/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const goals = await storage.getGoalsByUserId(userId);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });
  
  // Get AI-suggested goals, tasks, and habits based on journal entries
  // This endpoint generates new AI suggestions and stores them in the database
  app.get("/api/goals/:userId/generate-suggestions", async (req, res) => {
    console.log(`⭐ GET /api/goals/:userId/generate-suggestions called for userId: ${req.params.userId}`);
    console.log(`⭐ Is authenticated: ${req.isAuthenticated()}`);
    
    if (!req.isAuthenticated()) {
      console.log(`❌ GET /api/goals/:userId/generate-suggestions failed authentication check`);
      return res.sendStatus(401);
    }
    
    const userId = Number(req.params.userId);
    console.log(`⭐ User ID from auth: ${req.user?.id}, requested userId: ${userId}`);
    
    if (req.user?.id !== userId) {
      console.log(`❌ GET /api/goals/:userId/generate-suggestions failed user ID check`);
      return res.sendStatus(403);
    }
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error("⚠️ OPENAI_API_KEY is missing. Cannot generate suggestions.");
      return res.status(500).json({ 
        error: "OpenAI API key is missing. Please contact support to enable AI features." 
      });
    }
    
    try {
      // Get count of unanalyzed journal entries
      const journalEntries = await storage.getUnanalyzedJournalEntriesByUserId(userId);
      
      if (journalEntries.length === 0) {
        console.log(`⚠️ No unanalyzed journal entries found for user ${userId}`);
        return res.status(200).json({ 
          goals: [],
          habits: [],
          summary: {
            goalsCreated: 0, tasksCreated: 0, habitsCreated: 0,
            goalsSkipped: 0, tasksSkipped: 0, habitsSkipped: 0
          },
          message: "No journal entries to analyze. Write in your journal first to get suggestions."
        });
      }
      
      console.log(`✅ Processing ${Math.min(journalEntries.length, 3)} unanalyzed journal entries for user ${userId}`);
      
      // Process a limited number of unanalyzed journal entries using the unified AI suggestion module
      // Limit to 3 entries at a time to prevent timeouts and API overload
      const result = await processAllEntriesForUser(userId, 3);
      
      // Get the newly created suggested goals and habits
      const suggestedGoals = await storage.getAISuggestedGoals(userId);
      const suggestedHabits = await storage.getAISuggestedHabits(userId);
      
      // Return the summary of what was created
      res.json({ 
        goals: suggestedGoals,
        habits: suggestedHabits,
        summary: {
          goalsCreated: result.goalsCreated,
          tasksCreated: result.tasksCreated,
          habitsCreated: result.habitsCreated,
          goalsSkipped: result.goalsSkipped,
          tasksSkipped: result.tasksSkipped,
          habitsSkipped: result.habitsSkipped
        }
      });
    } catch (error: any) {
      console.error("Error generating and storing AI suggestions:", error);
      
      // Provide more specific error messages based on the error type
      if (error.toString().includes("OpenAI API")) {
        res.status(500).json({ 
          error: "There was an issue with the AI suggestion system. Please try again later or contact support." 
        });
      } else {
        res.status(500).json({ 
          error: "Failed to generate AI suggestions. Please try again later." 
        });
      }
    }
  });
  
  // This endpoint retrieves all AI suggested goals, tasks, and habits for a user
  app.get("/api/goals/:userId/ai-suggestions", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      // Get AI suggestions from their respective tables
      const goalSuggestions = await storage.getAiGoalsByUserId(userId);
      const taskSuggestions = await storage.getAiTasksByUserId(userId);
      const habitSuggestions = await storage.getAiHabitsByUserId(userId);
      
      console.log(`Retrieved AI suggestions for user ${userId}: ${goalSuggestions.length} goals, ${taskSuggestions.length} tasks, ${habitSuggestions.length} habits`);
      
      res.json({ 
        goals: goalSuggestions, 
        tasks: taskSuggestions,
        habits: habitSuggestions 
      });
    } catch (error) {
      console.error("Error retrieving AI suggestions:", error);
      res.status(500).json({ error: "Failed to retrieve AI suggestions" });
    }
  });
  
  // New endpoint for accepting an AI suggested goal
  app.post("/api/ai-goals/:id/accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const goalId = Number(req.params.id);
      
      console.log(`Accepting AI goal with ID: ${goalId}, user: ${req.user?.id}`);
      
      // Get the AI goal to verify ownership
      const aiGoal = await storage.getAiGoalById(goalId);
      if (!aiGoal) {
        console.error(`AI goal with ID ${goalId} not found`);
        return res.status(404).json({ error: "AI suggested goal not found" });
      }
      
      console.log(`Found AI goal:`, aiGoal);
      
      // Verify ownership
      if (req.user?.id !== aiGoal.userId) {
        console.error(`User ${req.user?.id} tried to accept AI goal belonging to user ${aiGoal.userId}`);
        return res.status(403).json({ error: "You don't have permission to accept this goal" });
      }
      
      // Accept the goal (moves it to main goals table and deletes from AI table)
      const newGoal = await storage.acceptAiGoal(goalId);
      
      console.log(`Successfully accepted AI goal:`, newGoal);
      
      res.status(200).json(newGoal);
    } catch (error) {
      console.error("Error accepting AI suggested goal:", error);
      res.status(500).json({ 
        error: "Failed to accept AI suggested goal",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // New endpoint for accepting an AI suggested task
  app.post("/api/ai-tasks/:id/accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const taskId = Number(req.params.id);
      
      console.log(`Accepting AI task with ID: ${taskId}, user: ${req.user?.id}`);
      
      // Get the AI task to verify ownership
      const aiTask = await storage.getAiTaskById(taskId);
      if (!aiTask) {
        console.error(`AI task with ID ${taskId} not found`);
        return res.status(404).json({ error: "AI suggested task not found" });
      }
      
      console.log(`Found AI task:`, aiTask);
      
      // Verify ownership
      if (req.user?.id !== aiTask.userId) {
        console.error(`User ${req.user?.id} tried to accept AI task belonging to user ${aiTask.userId}`);
        return res.status(403).json({ error: "You don't have permission to accept this task" });
      }
      
      // Accept the task (moves it to main tasks table and deletes from AI table)
      const newTask = await storage.acceptAiTask(taskId);
      
      console.log(`Successfully accepted AI task:`, newTask);
      
      res.status(200).json(newTask);
    } catch (error) {
      console.error("Error accepting AI suggested task:", error);
      res.status(500).json({ 
        error: "Failed to accept AI suggested task", 
        message: error.message || "Unknown error"
      });
    }
  });
  
  // New endpoint for accepting an AI suggested habit
  app.post("/api/ai-habits/:id/accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const habitId = Number(req.params.id);
      
      console.log(`Accepting AI habit with ID: ${habitId}, user: ${req.user?.id}`);
      
      // Get the AI habit to verify ownership
      const aiHabit = await storage.getAiHabitById(habitId);
      if (!aiHabit) {
        console.error(`AI habit with ID ${habitId} not found`);
        return res.status(404).json({ error: "AI suggested habit not found" });
      }
      
      console.log(`Found AI habit:`, aiHabit);
      
      // Verify ownership
      if (req.user?.id !== aiHabit.userId) {
        console.error(`User ${req.user?.id} tried to accept AI habit belonging to user ${aiHabit.userId}`);
        return res.status(403).json({ error: "You don't have permission to accept this habit" });
      }
      
      // Accept the habit (moves it to main habits table and deletes from AI table)
      const newHabit = await storage.acceptAiHabit(habitId);
      
      console.log(`Successfully accepted AI habit:`, newHabit);
      
      res.status(200).json(newHabit);
    } catch (error) {
      console.error("Error accepting AI suggested habit:", error);
      res.status(500).json({ 
        error: "Failed to accept AI suggested habit",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // New endpoints for rejecting AI suggestions (just deletes them)
  app.delete("/api/ai-goals/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const goalId = Number(req.params.id);
      
      // Get the AI goal to verify ownership
      const aiGoal = await storage.getAiGoalById(goalId);
      if (!aiGoal) {
        return res.status(404).json({ error: "AI suggested goal not found" });
      }
      
      // Verify ownership
      if (req.user?.id !== aiGoal.userId) {
        return res.sendStatus(403);
      }
      
      // Delete the AI goal
      await storage.deleteAiGoal(goalId);
      
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting AI suggested goal:", error);
      res.status(500).json({ error: "Failed to delete AI suggested goal" });
    }
  });
  
  app.delete("/api/ai-tasks/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const taskId = Number(req.params.id);
      
      // Get the AI task to verify ownership
      const aiTask = await storage.getAiTaskById(taskId);
      if (!aiTask) {
        return res.status(404).json({ error: "AI suggested task not found" });
      }
      
      // Verify ownership
      if (req.user?.id !== aiTask.userId) {
        return res.sendStatus(403);
      }
      
      // Delete the AI task
      await storage.deleteAiTask(taskId);
      
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting AI suggested task:", error);
      res.status(500).json({ error: "Failed to delete AI suggested task" });
    }
  });
  
  app.delete("/api/ai-habits/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const habitId = Number(req.params.id);
      
      // Get the AI habit to verify ownership
      const aiHabit = await storage.getAiHabitById(habitId);
      if (!aiHabit) {
        return res.status(404).json({ error: "AI suggested habit not found" });
      }
      
      // Verify ownership
      if (req.user?.id !== aiHabit.userId) {
        return res.sendStatus(403);
      }
      
      // Delete the AI habit
      await storage.deleteAiHabit(habitId);
      
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting AI suggested habit:", error);
      res.status(500).json({ error: "Failed to delete AI suggested habit" });
    }
  });
  
  // This endpoint accepts an AI suggested goal
  app.post("/api/goals/:goalId/accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const goalId = Number(req.params.goalId);
    
    try {
      // Get the goal to verify ownership
      const goal = await storage.getGoalById(goalId);
      
      if (!goal) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      if (req.user?.id !== goal.userId) {
        return res.sendStatus(403);
      }
      
      // Update the goal status to in_progress
      const updatedGoal = await storage.updateGoalStatus(goalId, "in_progress");
      
      res.json(updatedGoal);
    } catch (error) {
      console.error("Error accepting AI goal suggestion:", error);
      res.status(500).json({ error: "Failed to accept goal suggestion" });
    }
  });
  
  // This endpoint rejects an AI suggested goal
  app.post("/api/goals/:goalId/reject", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const goalId = Number(req.params.goalId);
    
    try {
      // Get the goal to verify ownership
      const goal = await storage.getGoalById(goalId);
      
      if (!goal) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      if (req.user?.id !== goal.userId) {
        return res.sendStatus(403);
      }
      
      // Delete the suggested goal
      await storage.deleteGoal(goalId);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error rejecting AI goal suggestion:", error);
      res.status(500).json({ error: "Failed to reject goal suggestion" });
    }
  });
  
  app.get("/api/tasks/:userId/suggestions", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error("⚠️ OPENAI_API_KEY is missing. Cannot generate task suggestions.");
      return res.status(500).json({ 
        error: "OpenAI API key is missing. Please contact support to enable AI features." 
      });
    }
    
    try {
      // Get count of unanalyzed journal entries
      const journalEntries = await storage.getUnanalyzedJournalEntriesByUserId(userId);
      
      if (journalEntries.length === 0) {
        console.log(`⚠️ No unanalyzed journal entries found for user ${userId}`);
        
        // Get all tasks to display to the user - even with no new suggestions
        const tasks = await storage.getTasksByUserId(userId);
        
        return res.status(200).json({ 
          tasks: tasks,
          summary: {
            goalsCreated: 0, tasksCreated: 0, habitsCreated: 0,
            goalsSkipped: 0, tasksSkipped: 0, habitsSkipped: 0
          },
          message: "No journal entries to analyze. Write in your journal first to get suggestions."
        });
      }
      
      console.log(`✅ Processing ${Math.min(journalEntries.length, 3)} unanalyzed journal entries for user ${userId}`);
      
      // Process a limited number of unanalyzed journal entries
      const result = await processAllEntriesForUser(userId, 3);
      
      // Get all tasks to display to the user
      const tasks = await storage.getTasksByUserId(userId);
      
      // Return both the tasks and the summary of what was processed
      res.json({ 
        tasks: tasks,
        summary: {
          goalsCreated: result.goalsCreated,
          tasksCreated: result.tasksCreated,
          habitsCreated: result.habitsCreated,
          goalsSkipped: result.goalsSkipped,
          tasksSkipped: result.tasksSkipped,
          habitsSkipped: result.habitsSkipped
        }
      });
    } catch (error: any) {
      console.error("Error generating task suggestions:", error);
      
      // Provide more specific error messages based on the error type
      if (error.toString().includes("OpenAI API")) {
        res.status(500).json({ 
          error: "There was an issue with the AI suggestion system. Please try again later or contact support." 
        });
      } else {
        res.status(500).json({ 
          error: "Failed to generate task suggestions. Please try again later." 
        });
      }
    }
  });
  
  // Endpoint to get deleted goals for a user
  app.get("/api/goals/:userId/deleted", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const deletedGoals = await storage.getDeletedGoalsByUserId(userId);
      res.json(deletedGoals);
    } catch (error) {
      console.error("Error fetching deleted goals:", error);
      res.status(500).json({ error: "Failed to fetch deleted goals" });
    }
  });
  
  // Endpoint to restore a deleted goal
  app.post("/api/goals/:id/restore", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const goalId = Number(req.params.id);
    
    try {
      const goal = await storage.getGoalById(goalId);
      
      if (!goal) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      if (goal.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to restore this goal" });
      }
      
      const restoredGoal = await storage.restoreGoal(goalId);
      res.status(200).json(restoredGoal);
    } catch (error) {
      console.error("Error restoring goal:", error);
      res.status(500).json({ error: "Failed to restore goal" });
    }
  });

  // Endpoint to get deleted tasks for a user
  app.get("/api/tasks/:userId/deleted", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const deletedTasks = await storage.getDeletedTasksByUserId(userId);
      res.json(deletedTasks);
    } catch (error) {
      console.error("Error fetching deleted tasks:", error);
      res.status(500).json({ error: "Failed to fetch deleted tasks" });
    }
  });
  
  // Endpoint to restore a deleted task
  app.post("/api/tasks/:id/restore", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const taskId = Number(req.params.id);
    
    try {
      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      if (task.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to restore this task" });
      }
      
      const restoredTask = await storage.restoreTask(taskId);
      res.status(200).json(restoredTask);
    } catch (error) {
      console.error("Error restoring task:", error);
      res.status(500).json({ error: "Failed to restore task" });
    }
  });
  
  // Endpoint to convert a task to a goal
  app.post("/api/tasks/:id/convert-to-goal", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const taskId = Number(req.params.id);
    
    try {
      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      if (task.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to convert this task" });
      }
      
      const newGoal = await storage.convertTaskToGoal(taskId);
      res.status(200).json(newGoal);
    } catch (error) {
      console.error("Error converting task to goal:", error);
      res.status(500).json({ error: "Failed to convert task to goal" });
    }
  });
  
  // Endpoint to get deleted habits for a user
  app.get("/api/habits/:userId/deleted", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const deletedHabits = await storage.getDeletedHabitsByUserId(userId);
      res.json(deletedHabits);
    } catch (error) {
      console.error("Error fetching deleted habits:", error);
      res.status(500).json({ error: "Failed to fetch deleted habits" });
    }
  });
  
  // Endpoint to restore a deleted habit
  app.post("/api/habits/:id/restore", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const habitId = Number(req.params.id);
    
    try {
      const habit = await storage.getHabitById(habitId);
      
      if (!habit) {
        return res.status(404).json({ error: "Habit not found" });
      }
      
      if (habit.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to restore this habit" });
      }
      
      const restoredHabit = await storage.restoreHabit(habitId);
      res.status(200).json(restoredHabit);
    } catch (error) {
      console.error("Error restoring habit:", error);
      res.status(500).json({ error: "Failed to restore habit" });
    }
  });
  
  app.get("/api/habits/:userId/suggestions", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error("⚠️ OPENAI_API_KEY is missing. Cannot generate habit suggestions.");
      return res.status(500).json({ 
        error: "OpenAI API key is missing. Please contact support to enable AI features." 
      });
    }
    
    try {
      // Get count of unanalyzed journal entries
      const journalEntries = await storage.getUnanalyzedJournalEntriesByUserId(userId);
      
      if (journalEntries.length === 0) {
        console.log(`⚠️ No unanalyzed journal entries found for user ${userId}`);
        
        // Get AI suggested habits - even with no new suggestions
        const suggestedHabits = await storage.getAISuggestedHabits(userId);
        
        return res.status(200).json({ 
          habits: suggestedHabits,
          summary: {
            goalsCreated: 0, tasksCreated: 0, habitsCreated: 0,
            goalsSkipped: 0, tasksSkipped: 0, habitsSkipped: 0
          },
          message: "No journal entries to analyze. Write in your journal first to get suggestions."
        });
      }
      
      console.log(`✅ Processing ${Math.min(journalEntries.length, 3)} unanalyzed journal entries for user ${userId}`);
      
      // Process a limited number of unanalyzed journal entries
      const result = await processAllEntriesForUser(userId, 3);
      
      // Get AI suggested habits
      const suggestedHabits = await storage.getAISuggestedHabits(userId);
      
      res.json({ 
        habits: suggestedHabits,
        summary: {
          goalsCreated: result.goalsCreated,
          tasksCreated: result.tasksCreated,
          habitsCreated: result.habitsCreated,
          goalsSkipped: result.goalsSkipped,
          tasksSkipped: result.tasksSkipped,
          habitsSkipped: result.habitsSkipped
        }
      });
    } catch (error: any) {
      console.error("Error generating habit suggestions:", error);
      
      // Provide more specific error messages based on the error type
      if (error.toString().includes("OpenAI API")) {
        res.status(500).json({ 
          error: "There was an issue with the AI suggestion system. Please try again later or contact support." 
        });
      } else {
        res.status(500).json({ 
          error: "Failed to generate habit suggestions. Please try again later." 
        });
      }
    }
  });

  app.post("/api/goals", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const { userId, name, description, category, targetDate, target, unit, colorScheme } = req.body;
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const goal = await storage.createGoal({
        userId,
        name,
        description,
        category,
        targetDate,
        target,
        progress: 0,
        unit,
        colorScheme
      });
      res.status(201).json(goal);
    } catch (error) {
      console.error("Goal creation error:", error);
      res.status(500).json({ error: "Failed to create goal" });
    }
  });

  app.patch("/api/goals/:goalId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const goalId = Number(req.params.goalId);
    
    try {
      const goal = await storage.getGoalById(goalId);
      if (!goal) return res.status(404).json({ error: "Goal not found" });
      if (goal.userId !== req.user?.id) return res.sendStatus(403);
      
      // Handle both full goal updates and progress-only updates
      if (req.body.hasOwnProperty('progress') && Object.keys(req.body).length === 1) {
        // This is a progress-only update
        const { progress } = req.body;
        const updatedGoal = await storage.updateGoalProgress(goalId, progress);
        return res.json(updatedGoal);
      } else {
        // This is a full goal update
        // First, create a new goal with the updated data
        const updatedData = {
          ...req.body,
          userId: req.user.id
        };
        
        // Delete old goal
        await storage.deleteGoal(goalId);
        
        // Create new goal with updated data
        const updatedGoal = await storage.createGoal(updatedData);
        return res.json(updatedGoal);
      }
    } catch (error) {
      console.error("Goal update error:", error);
      res.status(500).json({ error: "Failed to update goal" });
    }
  });
  
  app.delete("/api/goals/:goalId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const goalId = Number(req.params.goalId);
    
    try {
      const goal = await storage.getGoalById(goalId);
      if (!goal) return res.status(404).json({ error: "Goal not found" });
      if (goal.userId !== req.user?.id) return res.sendStatus(403);
      
      await storage.deleteGoal(goalId);
      res.sendStatus(200);
    } catch (error) {
      console.error("Goal deletion error:", error);
      res.status(500).json({ error: "Failed to delete goal" });
    }
  });
  
  // Endpoint to convert a goal to a task
  app.post("/api/goals/:id/convert-to-task", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const goalId = Number(req.params.id);
    
    try {
      const goal = await storage.getGoalById(goalId);
      
      if (!goal) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      if (goal.userId !== req.user?.id) {
        return res.status(403).json({ error: "You don't have permission to convert this goal" });
      }
      
      const newTask = await storage.convertGoalToTask(goalId);
      res.status(200).json(newTask);
    } catch (error) {
      console.error("Error converting goal to task:", error);
      res.status(500).json({ error: "Failed to convert goal to task" });
    }
  });

  // Prompts API
  app.get("/api/prompts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      // Get some starter prompts if user has no history yet
      let prompts = await storage.getDefaultPrompts();
      
      // If user has journal history, generate custom prompts
      const recentEntries = await storage.getRecentJournalEntriesByUserId(req.user.id, 5);
      if (recentEntries.length > 0) {
        const userEntries = recentEntries
          .filter(entry => !entry.isAiResponse)
          .map(entry => entry.content);
        
        const recentMoods = await storage.getRecentMoodsByUserId(req.user.id, 7);
        const moodRatings = recentMoods.map(mood => mood.rating);
        
        if (userEntries.length > 0) {
          const customPromptTexts = await generateCustomPrompts(userEntries, moodRatings);
          
          // Create custom prompts in storage
          const customPrompts = [];
          for (const text of customPromptTexts) {
            const prompt = await storage.createPrompt({
              text,
              category: "custom"
            });
            customPrompts.push(prompt);
          }
          
          // Use custom prompts if available, otherwise fall back to defaults
          if (customPrompts.length > 0) {
            prompts = customPrompts;
          }
        }
      }
      
      res.json(prompts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch prompts" });
    }
  });

  // Weekly summary API
  app.get("/api/summary/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      // Get existing summary if available
      let summary = await storage.getSummaryByUserId(userId);
      
      // If no summary exists or it's older than a day, generate a new one
      if (!summary || new Date(summary.updatedAt).getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        const lastWeekEntries = await storage.getJournalEntriesForLastWeek(userId);
        
        if (lastWeekEntries.length === 0) {
          return res.status(404).json({ error: "Not enough journal entries to generate a summary" });
        }
        
        // Convert journal entries to the format expected by generateWeeklySummary
        const formattedEntries = lastWeekEntries.map(entry => ({
          content: entry.content,
          sentiment: entry.sentiment || undefined
        }));
        
        const weeklySummary = await generateWeeklySummary(formattedEntries);
        
        // Ensure arrays are properly formatted
        const formattedSummary = {
          userId,
          topEmotions: Array.isArray(weeklySummary.topEmotions) ? weeklySummary.topEmotions : [],
          commonThemes: Array.isArray(weeklySummary.commonThemes) ? weeklySummary.commonThemes : [],
          insights: weeklySummary.insights,
          updatedAt: new Date().toISOString()
        };
        
        summary = await storage.createOrUpdateSummary(formattedSummary);
      }
      
      res.json(summary);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate summary" });
    }
  });

  // Export journal entries (PDF not implemented in MVP)
  app.get("/api/export/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    if (req.user?.id !== userId) return res.sendStatus(403);
    
    try {
      const entries = await storage.getJournalEntriesByUserId(userId);
      
      // For MVP, just return JSON
      res.json({
        username: req.user.username,
        exportDate: new Date().toISOString(),
        entries: entries
      });
      
      // TODO: Add PDF generation in future versions
    } catch (error) {
      res.status(500).json({ error: "Failed to export journal entries" });
    }
  });

  // ------------------------
  // Notification System API
  // ------------------------
  
  // Get all notifications for the current user
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const notifications = await storage.getNotificationsByUserId(req.user.id);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });
  
  // Get only unread notifications for the current user
  app.get("/api/notifications/unread", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const unreadNotifications = await storage.getUnreadNotificationsByUserId(req.user.id);
      res.json(unreadNotifications);
    } catch (error) {
      console.error("Error fetching unread notifications:", error);
      res.status(500).json({ error: "Failed to fetch unread notifications" });
    }
  });
  
  // Create a new notification (admin or system use)
  app.post("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const notification = await storage.createNotification({
        ...req.body,
        userId: req.user.id
      });
      res.status(201).json(notification);
    } catch (error) {
      console.error("Error creating notification:", error);
      res.status(500).json({ error: "Failed to create notification" });
    }
  });
  
  // Update notification status (mark as read/dismissed)
  app.patch("/api/notifications/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const notificationId = Number(req.params.id);
    
    try {
      const notification = await storage.getNotificationById(notificationId);
      
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }
      
      if (notification.userId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized to update this notification" });
      }
      
      const updatedNotification = await storage.updateNotificationStatus(
        notificationId, 
        req.body.status
      );
      
      res.json(updatedNotification);
    } catch (error) {
      console.error("Error updating notification:", error);
      res.status(500).json({ error: "Failed to update notification" });
    }
  });
  
  // Delete a single notification
  app.delete("/api/notifications/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const notificationId = Number(req.params.id);
    
    try {
      const notification = await storage.getNotificationById(notificationId);
      
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }
      
      if (notification.userId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized to delete this notification" });
      }
      
      await storage.deleteNotification(notificationId);
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting notification:", error);
      res.status(500).json({ error: "Failed to delete notification" });
    }
  });
  
  // Delete all notifications for the current user
  app.delete("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      await storage.deleteAllNotificationsByUserId(req.user.id);
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting all notifications:", error);
      res.status(500).json({ error: "Failed to delete all notifications" });
    }
  });
  
  // Get notification preferences for the current user
  app.get("/api/notification-preferences", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const preferences = await storage.getNotificationPreferencesByUserId(req.user.id);
      
      if (!preferences) {
        // Create default preferences if none exist
        const defaultPreferences = await storage.createOrUpdateNotificationPreferences({
          userId: req.user.id,
          journalReminders: true,
          goalReminders: true,
          weeklyDigest: true,
          emailNotifications: true,
          browserNotifications: true,
          reminderTime: "09:00"
        });
        return res.json(defaultPreferences);
      }
      
      res.json(preferences);
    } catch (error) {
      console.error("Error fetching notification preferences:", error);
      res.status(500).json({ error: "Failed to fetch notification preferences" });
    }
  });
  
  // Update notification preferences for the current user
  app.patch("/api/notification-preferences", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const preferences = await storage.createOrUpdateNotificationPreferences({
        ...req.body,
        userId: req.user.id
      });
      res.json(preferences);
    } catch (error) {
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  });

  // OAuth settings API
  // API routes for settings and admin functionality
  // Set up habit routes
  setupHabitRoutes(app);
  
  app.use("/api/settings", oauthSettingsRoutes);
  app.use("/api/settings", openaiSettingsRoutes);
  app.use("/api/admin", adminStatsRoutes);
  
  // Trigger AI suggestion processing for all users (admin only)
  app.post("/api/admin/process-all-journal-entries", async (req, res) => {
    if (!req.isAuthenticated() || !req.user?.isAdmin) return res.sendStatus(403);
    
    try {
      // This is a non-blocking operation - it will run in the background
      processAllEntries().catch(error => {
        console.error("Background processing of all journal entries failed:", error);
      });
      
      res.json({ 
        success: true, 
        message: "AI suggestion processing has been triggered for all users and will run in the background."
      });
    } catch (error) {
      console.error("Error starting AI suggestion processing:", error);
      res.status(500).json({ error: "Failed to start processing" });
    }
  });
  
  // Manually trigger AI suggestion processing for a specific user
  app.post("/api/suggestions/process-user/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = Number(req.params.userId);
    
    // Verify ownership or admin
    if (req.user?.id !== userId && !req.user?.isAdmin) {
      return res.sendStatus(403);
    }
    
    try {
      const result = await processAllEntriesForUser(userId);
      
      res.json({
        success: true,
        message: `Successfully processed unanalyzed journal entries and generated ${result.goalsCreated} goals and ${result.tasksCreated} tasks.`,
        result
      });
    } catch (error) {
      console.error(`Error processing journal entries for user ${userId}:`, error);
      res.status(500).json({ error: "Failed to process journal entries" });
    }
  });
  app.use("/api/subscription", subscriptionRoutes);
  app.use("/api", paypalSettingsRoutes);

  // Register avatar routes
  registerAvatarRoutes(app);
  
  // Generate titles for existing journal entries
  app.post("/api/admin/generate-journal-titles", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (!req.user?.isAdmin) return res.sendStatus(403);
    
    try {
      // Get all journal entries without titles (where title is null or empty string)
      const entriesWithoutTitles = await db
        .select()
        .from(journalEntries)
        .where(
          eq(journalEntries.isJournal, true)
        );
      
      console.log(`Found ${entriesWithoutTitles.length} entries that might need titles.`);
      
      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;
      
      // Process each entry
      for (const entry of entriesWithoutTitles) {
        try {
          // Skip entries that already have a title
          if (entry.title) {
            console.log(`Entry ${entry.id} already has title: "${entry.title}". Skipping.`);
            skippedCount++;
            continue;
          }
          
          console.log(`Generating title for entry ${entry.id}...`);
          
          // Use content or transcript (if available) for title generation
          const contentForTitle = entry.transcript || entry.content;
          
          // Generate title
          const title = await generateJournalTitle(contentForTitle);
          
          // Update the entry with the new title
          await db
            .update(journalEntries)
            .set({ title })
            .where(eq(journalEntries.id, entry.id));
          
          console.log(`Updated entry ${entry.id} with title: "${title}"`);
          successCount++;
          
          // Add a small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error processing entry ${entry.id}:`, error);
          errorCount++;
        }
      }
      
      res.json({
        message: "Title generation complete",
        stats: {
          total: entriesWithoutTitles.length,
          generated: successCount,
          skipped: skippedCount,
          failed: errorCount
        }
      });
    } catch (error) {
      console.error("Error generating titles for journal entries:", error);
      res.status(500).json({ error: "Failed to generate titles for journal entries" });
    }
  });
  
  const httpServer = createServer(app);
  return httpServer;
}
